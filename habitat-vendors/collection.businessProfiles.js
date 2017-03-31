class businessProfilesCollection extends Mongo.Collection {
  insert(doc, callback) {
    transactions.methods.searchForAddress.call({address: doc.company_address}, (err, res) => {
      if(err) { throwError(err.message); } else if(res && res.features.length){
        const newId = Random.id();
        return super.insert(_.extend(doc, {
          prep_time: parseInt(doc.prep_time),
          open: false,
          featured: false,
          clicks: 0,
          DaaS: true,
          order: businessProfiles.find().count() + 1,
          categories: [ 'none' ], //need to start w/ this or reassigning category won't work
          transactionCount: 0,
          employees: [],
          weeklyHours: this.setHours(),
          geometry: res.features[0].geometry,
        }), (err, newBizId) => {
          if(err) { throwError(err.message); }
          if(Meteor.isServer){
            const bp = businessProfiles.findOne(newBizId);
            const bizArr = [newBizId];
            const pw = `${generateBizPass(doc.company_name)}`;
            Accounts.createUser({
              _id: newId,
              email: bp.company_email,
              password: pw,
              company_name: bp.company_name,
              profile: {
                orderPhone: parseInt(bp.orderPhone),
                habitat: Habitats.findOne(bp.habitat[0])._id
              },
            });
            Meteor.users.update(newId, {$set: {'profile.businesses': bizArr}}, err => err ? console.warn(err.message) : console.log('success'));
            businessProfiles.update(newBizId, {$set: {
              uid: newId
            }}, (err, res) => {
              if(err) { throwError(err.message); }
              Roles.addUsersToRoles(newId, 'vendor');
              mailman.onboard.biz(bp, pw);
            });
          }
        }, callback);
      }
    });
  }
  remove(id, callback){
    return super.remove(id, (err, res) => {
      if(err) { throw new Meteor.Error(err.message); }
      Modifiers.remove({uid: id}, {multi: true});
      saleItems.remove({uid: id}, {multi: true});
    });
  }
  forceRemove(callback){
    return super.remove({}, callback);
  }
  forceInsert(docs, callback){
    return docs.forEach((doc) => {
      super.insert(doc, {validate: false}, (err, id) => {
        if(err) { throwError(err.message); } else {
          fakePhone = getRandomPhone(10);
          businessProfiles.update(id, {$set: {
            orderPhone: fakePhone,
            employees: [],
            faxPhone: fakePhone.toString(),
            company_name: `FAKE ${doc.company_name}`,
            company_phone: fakePhone.toString(),
            company_email: faker.internet.email(),
          }}, (err) => { if(err) { throwError(err.message); }});
        }
      });
    });
  }
  setHours(id){
    hoursArray = [];
    rateObj = {
      vendorPremium: false,
      deliveryFee: 2.99,
      vendorRates: {
        pickup: { percent: 0.1, flat: 0 },
        delivery: { percent: 0.1, flat: 0 },
        freeDel: { percent: 0.25, flat: 0, minimum: 10 },
        DaaS: { percent: 0, flat: 5 }
      }
    };
    if(id) {
      hoursArray = businessProfiles.findOne(id).weeklyHours.map((hourObj) => {
        return _.extend(hourObj, rateObj);
      });
    } else {
      [0,1,2,3,4,5,6].forEach((i) => {
        var openHour = 9 * 3600000;
        var closeHour = 19 * 3600000;
        var dayBase = i * 86400000;
        hoursArray.push({
          day: i,
          open: true,
          vendorPremium: false,
          deliveryFee: 2.99,
          openHr: '9:00 AM',
          closeHr: '7:00 PM',
          openTime: dayBase + openHour,
          closeTime: dayBase + closeHour,
          vendorRates: rateObj.vendorRates,
        });
      });
    }

    return hoursArray;
  }
  openedAtToday(bizId) {
    openHr = this.getToday(bizId).openHr;
    hr = moment(openHr, ["h:mm"]).format("HH");
    min = moment(openHr, ["h:mm"]).format("mm");
    return moment().day(moment(Date.now()).day()).hour(hr).minute(min).format();
  }
  sendWeeklyReceipt(bizId, weekNum){
    const bp = businessProfiles.findOne(bizId);
    Mailer.send({
      to: `${bp.company_name} <${Meteor.users.findOne(bp.uid).username}>`,
      subject: `Weekly Transaction Summary for ${bp.company_name}`,
      template: 'emailVendorWeeklyPayout',
      data: { bizId: bizId, week: weekNum },
    });
  }
  getToday(id){
    const weeklyHours = businessProfiles.findOne(id).weeklyHours; check(weeklyHours, [Object]);
    return _.findWhere( weeklyHours, { day: moment().day() } );
  }
  getTomorrowOpen(id){
    const weeklyHours = businessProfiles.findOne(id).weeklyHours; check(weeklyHours, [Object]);
    return _.findWhere( weeklyHours, { day: moment().day() + 1} ) ? _.findWhere( weeklyHours, { day: moment().day() + 1} ).openHr : undefined;
  }
  deliveryFee(id){ return this.getToday(id).vendorPremium ? 0 : this.getToday(id).deliveryFee; }
  deliveryEstimate(id, inMinutes){
    const bp = businessProfiles.findOne(id);
    const delTime = Habitats.findOne(bp.habitat[0]).deliveryTime;
    return inMinutes ?
      bp.prep_time + delTime :
      Date.now() + (60000 * bp.prep_time) + (60000 * delTime);
  }
  pickupEstimate(doc){
    const bp = businessProfiles.findOne(doc.sellerId);
    return transactions.findOne(doc._id).timeRequested + (60000 * bp.prep_time);
  }
  rates(txId){
    if(!txId) { throwError('No txId passed in'); }
    const tx = transactions.findOne(txId); if(!tx) { throwError('No transaction found'); }
    const today = this.getToday(tx.sellerId);
    //TODO: refactor into calc package
    const meetsFreeDelCriteria = (
      tx.method === 'Delivery' &&
      today.vendorPremium &&
      tx.payRef.tp >= today.vendorRates.freeDel.minimum
    );

    const rates = tx.DaaS ? today.vendorRates.DaaS :
      today.vendorRates[
        meetsFreeDelCriteria ?
        'freeDel' :
        tx.method ? tx.method.toLowerCase() : 'pickup'
      ];
    const totalWithTax = tx.payRef.tp + (tx.payRef.tp * calc.taxRate);
    const txPayout = tx.payRef.tp - (tx.payRef.tp * rates.percent) - rates.flat;
    const DaaSTotal = today.vendorRates.DaaS.flat;

    return _.extend(rates,  {
      totalPrice: tx.DaaS ? DaaSTotal : tx.payRef.tp,
      totalWithTax: totalWithTax,
      vendorPayout: tx.DaaS ? - DaaSTotal : txPayout,
    });
  }
  getShortName(company_name) {
    const bizByWord = company_name.split(' ');
    const shortName = bizByWord.length < 1 ? bizByWord[0] : (bizByWord[0].length > 8 ? bizByWord[0] : `${bizByWord[0]} ${bizByWord[1]}`);
    const removeCommas = shortName.replace(/,/g , " ");
    return removeCommas.replace('&', ' and ');
  }
  bizInitials(bizName) { return bizName.split(' ').map(w => w.charAt(0)).join().replace(',','');}

}

businessProfiles = new businessProfilesCollection("businessprofiles");

businessProfiles.allow({
  update(){ return Roles.userIsInRole(Meteor.userId(), ['admin']); }
});