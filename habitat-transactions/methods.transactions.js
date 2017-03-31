transactions.methods = {
  insert: new ValidatedMethod({
    name: 'transactions.methods.insert',
    validate: new SimpleSchema({
      'order': { type: [Object]},
      'order.$.fromFeatured': { type: Boolean, optional: true, },
      'order.$.saleItemId': { type: String },
      'order.$.itemInstructions': { type: String, optional: true },
      'order.$.modifiers': { type: [String], optional: true },
      'sellerId': { type: String },
      'buyerId': { type: String },
      'habitat': { type: String },
      'isFlash': { type: Boolean , optional: true},
      'DaaS': { type: Boolean }
    }).validator(),
    run() {
      if(arguments[0].DaaS && Meteor.user() && !Meteor.user().roles.includes('vendor')) {
        throwError('Must be vendor to insert DaaS');
      } else {
        return transactions.insert(arguments[0]);
      }
    }
  }),
  //TODO: this method now handles all third party requests,
  //      should refactor across apps w/ more accurate method name
  insertDaaS: new ValidatedMethod({
    name: 'transactions.methods.insertDaaS',
    validate: new SimpleSchema({
      deliveryAddress: { type: String },
      loc: { type: Object, blackbox: true },
      sellerId: { type: String, optional: true },
      company_name: { type: String, optional: true },
      DaaSType: { type: String, optional: true, allowedValues: ['credit_card', 'cash', 'online'] },
      deliveryInstructions: { type: String, optional: true },
      suite: { type: String, optional: true },
      customerName: { type: String, optional: true },
      customerPhone: { type: String, optional: true },
      customerEmail: { type: String, optional: true },
      acceptUrl: { type: String, optional: true },
      orderSize: { type: Number, optional: true },
      payRef: { type: Object, optional: true, blackbox: true },
      thirdParty: { type: Boolean, optional: true },
      partnerName: { type: String, optional: true },
      fromAPI: { type: Boolean, optional: true },
      key: { type: String, optional: true },
      order: { type: [Object], optional: true, blackbox: true },
      isDelivery: { type: Boolean, optional: true },
    }).validator(),
    run( args ) {
      const biz = businessProfiles.findOne(
        args.company_name ? { company_name: args.company_name} :
        args.sellerId ||
        Meteor.user().profile.businesses[0]
      );
      return transactions.insert(_.extend(args, {
        createdAt: Date.now(),
        partnerName: args.thirdParty ? args.partnerName : false,
        createdAtHuman: new Date(),
        DaaS: false,
        sellerId: biz._id,
        habitat: biz.habitat[0],
        company_name: biz.company_name,
        status: 'created',
        method: args.isDelivery ? 'Delivery' : 'Pickup',
        orderNumber: transactions.pin(),
        order: args.order || [],
        acceptUrl: args.acceptUrl,
        customer: {
          phone: args.customerPhone,
          name: args.customerName,
        }
      }), (err, txId) => {
        if(err) { throwError(err.message); } else {
          console.log(transactions.findOne(txId));
          if(this.isSimulation) { subs.subscribe('delivery', Meteor.user().profile.businesses[0]); }

        }
      });
      }
  }),

  requestDaaS: new ValidatedMethod({
    name: 'transactions.methods.requestDaaS',
    validate: new SimpleSchema({
      deliveryId: { type: String },
      prepTime: { type: Number, optional: true },
      deliveryInstructions: { type: String, optional: true },
      suite: { type: String, optional: true },
      customerName: { type: String, optional: true },
      customerPhone: { type: String, optional: true },
      runnerId: { type: String, optional: true },
    }).validator(),
    run({ deliveryId, prepTime }) {
      //TODO: ask nate about how to best protect if handled by route...perhaps an API key generated when request is made
      // if(!Roles.userIsInRole(Meteor.userId(), ['admin', 'vendor', 'runner'])) { throwError(503, "Sorry, no vendor access"); }
      if (!prepTime) {prepTime = transactions.findOne(deliveryId) ? transactions.findOne(deliveryId).prepTime : businessProfiles.findOne(transactions.findOne(deliveryId).sellerId).prep_time;}
      arguments[0].readyAt = new Date(Date.now() + (prepTime * 60000));
        return transactions.update(deliveryId, {
          $set: _.extend(arguments[0], transactions.requestItems(deliveryId, prepTime))
        }, (err) => {
          if(err) { throwError(err.message); }
          if(!this.isSimulation) {
            DDPenv().call('sendRunnerPing', deliveryId, false, initialPing=true, (err, res) => {
              if(err) { throwError(err.message); }
            });
          } else { as.trackRunnerAccept(txId, runnerId, this.userId); }
        });
    }
  }),

  handleOrder: new ValidatedMethod({
    name: 'transactions.methods.handleOrder',
    validate: new SimpleSchema({
      'order': { type: [Object]},
      'order.$.fromFeatured': { type: Boolean, optional: true, },
      'order.$.saleItemId': { type: String },
      'order.$.itemInstructions': { type: String, optional: true },
      'order.$.modifiers': { type: [String], optional: true },
      'sellerId': { type: String },
      'buyerId': { type: String },
      'habitat': { type: String },
      'DaaS': { type: Boolean, optional: true},
    }).validator(),
    run() {
      const args = arguments[0];
      const currentOpenTx = Meteor.users.getOpenTx(args.buyerId);
      if(!currentOpenTx){
        newTxId = '';
        transactions.methods.insert.call(args, (err, id) => {
          if(err) { throwError(err.message); } else {
            newTxId = id;
            if(this.isSimulation){
              modOverlay.animate.close();
              orderFooter.showCheckout();
              as.startedNewCart(args);
            }
          }
        });
        return newTxId;
      } else if(currentOpenTx){
        if(args.sellerId === currentOpenTx.sellerId){
          transactions.update(currentOpenTx._id, { $set: {
            order: currentOpenTx.order.concat(transactions.formatOrder(args.order))
            }}, (err) => { if(err){ throwError(err.message); } else {
              if(this.isSimulation){
                modOverlay.animate.close();
                orderFooter.showCheckout();
                as.addedItemToCart(args);
              }
              return currentOpenTx._id;
            }
          });
        } else {
          if(this.isSimulation){
            return sweetAlert(sweetAlert.copy.removeExisting(currentOpenTx._id, args.sellerId), (isConfirm) => {
              return isConfirm ? transactions.methods.removeTransaction.call({ txIds: [currentOpenTx._id] }, (err) => {
                if (err) { throw new Meteor.Error(err.message); } else {
                  if(this.isSimulation){
                    modOverlay.animate.close();
                    return transactions.methods.insert.call(args, (err) => {
                      if(err) { sweetAlert('Error', err.message); }
                    });
                  }
                }
              }) : false;
            });
          }
        }
      }
    }
  }),

  removeTransaction: new ValidatedMethod({
    name: 'transactions.methods.removeTransaction',
    validate: new SimpleSchema({
      txIds: { type: [String] }
    }).validator(),
    run({ txIds }) {
      transactions.update({_id: {$in: txIds}}, {$set: {
        status: 'discarded',
        promoId: null,
      }}, (err, res) => { if(err) { throwError(err.message); } else {
      }});
    }
  }),

  clearOpen: new ValidatedMethod({
    name: 'transactions.methods.clearOpen',
    validate: new SimpleSchema({
      txId: { type: String }
    }).validator(),
    run({ txId }) {
      const userTrans = Meteor.user().profile.transactions;
      if (_.contains(userTrans, txId) || Roles.userIsInRole(Meteor.userId(), ['admin'])) {
        transactions.update(txId, {$set: {status: 'discarded'}});
      } else {
        throw new Meteor.Error('Unauthorized client');
      }
    }
  }),

  acceptPickup: new ValidatedMethod({
    name: 'transactions.methods.acceptPickup',
    validate: new SimpleSchema({
      txId: { type: String },
    }).validator(),
    run({ txId }) {
      const tx = transactions.findOne(txId);
      DDPenv().call('sendPickupAcceptedUserText', Meteor.users.findOne(tx.buyerId).profile.phone, tx._id);
      transactions.update(txId, {$set: {status: 'in_progress'}});
    }
  }),

  acceptDelivery: new ValidatedMethod({
  name: 'transactions.methods.acceptDelivery',
  validate: new SimpleSchema({
    txId: { type: String },
  }).validator(),
  run({ txId }) {
    const tx = transactions.findOne(txId);
    transactions.update(txId, {$set: {status: 'pending_runner'}}, (err) => {
    if(err) { throwError(err.message); } else if(!this.isSimulation){
      if (!tx.DaaS) {
        DDPenv().call('orderAcceptedBuyerText', tx._id, (err) => {
          if(err) { throwError(err.message); }
        });
      }
      DDPenv().call('sendRunnerPing', tx._id, runnerId=false, initialPing=true, (err) => {
        if(err) { console.warn(err.message); }
      });
      }
    });
  }
}),

confirmDropoff: new ValidatedMethod({
  name: 'transactions.methods.confirmDropoff',
  validate: new SimpleSchema({
    txId: { type: String },
    isAdmin: { type: Boolean },
    tip: { type: Number, decimal: true, optional: true}
  }).validator(),
  run({ txId, isAdmin, tip }) {
    const now = Date.now();
    update = {
      status: 'completed',
      dropoffTime: now,
      dropoffVariationMin: calc._roundToTwo(
        (now - transactions.findOne(txId).deliveredAtEst) / 60000
      ),
      settledByAdmin: isAdmin,
    };
    if(tip) { update.tip = tip; }
    transactions.update(txId, {$set: update}, (err) => {if (err) { throw new Meteor.Error(err.message); }});

  }
}),

sendReceiptImage: new ValidatedMethod({
  name: 'transactions.methods.sendReceiptImage',
  validate: new SimpleSchema({
    txId: { type: String, },
    tip: { type: Number, decimal: true, },
    image: { type: String, },
    runnerId: { type: String, },
  }).validator(),
  run({ txId, image, runnerId}) {
    if(Meteor.isServer) {
      const tx = transactions.findOne(txId);
      runner.sendReceipt(req=false, tx, tx.orderNumber, image, tx.runnerId, tip);
    }


  }
}),

  clearPast: new ValidatedMethod({
    name: 'transactions.methods.clearPast',
    validate: null,
    run() {
      transactions.update({ buyerId: Meteor.userId(), status: 'completed' }, {$set: {status: 'archived'}}, {multi: true});
    }
  }),

  assignRunner: new ValidatedMethod({
    name: 'transactions.methods.assignRunner',
    validate: new SimpleSchema({
      txId: { type: String, optional: true },
      orderNumber: { type: Number, optional: true },
      runnerId: {type: String },
      adminAssign: { type: Boolean }
    }).validator(),
    run({ txId, orderNumber, runnerId, adminAssign }) {
      const tx = transactions.findOne(txId ?
        {_id: txId, status: 'pending_runner'} :
        {orderNumber: orderNumber, status: 'pending_runner'}
      );

      if(runnerId && tx.runnerId){ throwError('409', 'Already Accepted!'); }
      transactions.update(tx._id, { $set: {
        status: 'in_progress', runnerAssignedAt: new Date(), runnerId, adminAssign,
      }}, (err, num) => {
        DDPenv().call('sendRunnerPing', tx._id, runnerId, initialPing=false, (err, res) => {
          if(err) { throwError(err.message); } else {
            if(this.isSimulation) { as.trackRunnerAccept(txId, runnerId, this.userId); }
          }
        });
      });

    }
  }),

  reassignRunner: new ValidatedMethod({
    name: 'transactions.methods.reassignRunner',
    validate: new SimpleSchema({
      txId: { type: String },
      runId: {type: String }
    }).validator(),
    run({ txId, runId }) {
      const tx = transactions.findOne(txId);
      const previousRunnerPhone = Meteor.users.findOne(tx.runnerId).profile.phone;

      if (Roles.userIsInRole(Meteor.userId(), ['admin'])) {
        transactions.update(txId, {$set: {
          runnerId: runId,
          reassignCount: tx.reassignCount && tx.reassignCount.length ? tx.reassignCount.length : 1,
        }}, (err) => {
          if(err) { throwError(err.message); } else {
            if(!this.isSimulation) {
              twilio.messages.create({
                to: previousRunnerPhone, // Any number Twilio can deliver to
                from: Meteor.settings.twilio.twilioPhone, // A number you bought from Twilio and can use for outbound communication
                body: `${tx.orderNumber} reassigned`,
              }, (err, responseData) => { } );
              DDPenv().call('sendRunnerPing', txId, runId, false);
            }
          }
        });
      } else {
        throwError('Unauthorized client');
      }
    }
  }),

  remove: new ValidatedMethod({
    name: 'transactions.methods.remove',
    validate: new SimpleSchema({
      txId: { type: String },
      newBuyerId: { type: String, optional: true }
    }).validator(),
    run({ txId, newBuyerId}) {
      var tx = transactions.findOne(txId);
      if(!_.contains([this.userId, newBuyerId], tx.buyerId) || tx.status !== 'created') { throw new Meteor.Error('503, Unauthorized'); }
      return transactions.remove(txId);
    }
  }),

  choosePickDel: new ValidatedMethod({
    name: 'transactions.methods.choosePickDel',
    validate: new SimpleSchema({
      txId: { type: String },
      newBuyerId: { type: String, optional: true },
      method: { type: String, trim: true, allowedValues: ['Pickup', 'Delivery'] },
      address: { type: String, optional: true },
      geometry: { type: Object, blackbox: true, optional: true}
    }).validator(),
    run({ txId, method, newBuyerId, address, geometry }) {
      var tx = transactions.findOne(txId);
      var userId = this.userId || newBuyerId;
      if(tx.buyerId !== userId || tx.status !== 'created') { throw new Meteor.Error('503, Unauthorized'); }
      return transactions.update(tx._id, { $set: {
        method: method,
        cancelledByVendor: false,
        missedByVendor: false,
        deliveryAddress: address,
        geometry: geometry,
        promoId: method === 'Pickup' ? null : tx.promoId
      }}, (err) => {
        if(this.isSimulation){
          if(!err){
            Router.go("/hub" + "/" + tx._id + "/" + "confirmOrder");
            analytics.track(`Chose ${method}`, { transaction: txId });
          }
        } else if(err){
          throwError(err.message);
        }
      });
    }
  }),

  searchForAddress: new ValidatedMethod({
    name: 'transactions.methods.searchForAddress',
    validate: new SimpleSchema({
      address: { type: String },
    }).validator(),
    run({ address }) {
      if(!this.isSimulation){
        this.unblock();
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${address}.json`;
        const params = {
          params: {
            country: 'us',
            types: 'country,region,postcode,place,locality,neighborhood,address,poi',
            proximity: [ -75.1597308, 39.9802519 ],
            bbox: [-75.27935,39.888665,-75.084343,40.047854],
            access_token: Meteor.settings.public.mapboxKey
          }
        };

        try {
          const result = HTTP.get(url, params);
          if(result.statusCode === 200){
            return JSON.parse(result.content);
          }
        } catch (e) {
          JSON.stringify(e, null, 2);
          throw new Meteor.Error(e.code);
        }
      }
    }
  }),

  getAddrFromCoords: new ValidatedMethod({
    name: 'transactions.methods.getAddrFromCoords',
    validate: new SimpleSchema({
      lng: { type: Number, decimal: true },
      lat: { type: Number, decimal: true }
    }).validator(),
    run({lng, lat}) {
      if(!this.isSimulation){
        this.unblock();
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json`;
        const params = {
          params: {
            types: 'country,region,postcode,place,locality,neighborhood,address,poi',
            access_token: Meteor.settings.public.mapboxKey
          }
        };

        try {
          const result = HTTP.get(url, params);
          if(result.statusCode === 200){
            parsedRes = JSON.parse(result.content);
            if(parsedRes.features && parsedRes.features[0]) {
              addr = parsedRes.features[0];
              return `${addr.address} ${addr.text}`;
            }
          }
        } catch (e) {
          JSON.stringify(e, null, 2);
          throw new Meteor.Error(e.code);
        }
      }
    }
  }),

  reverseAddrSearch: new ValidatedMethod({
    name: 'transactions.methods.reverseAddrSearch',
    validate: new SimpleSchema({
      lng: { type: Number, decimal: true },
      lat: { type: Number, decimal: true }
    }).validator(),
    run({lng, lat}) {
      if(!this.isSimulation){

      }
    }
  }),

  addTxAddress: new ValidatedMethod({
    name: 'transactions.methods.addTxAddress',
    validate: new SimpleSchema({
      _id: { type: String },
      habId: { type: String },
      deliveryAddress: { type: String },
      geometry: { type: Object, blackbox: true }
    }).validator(),
    run({ _id, habId, geometry }) {
      if(this.isSimulation) { return analytics.track('Added address and info', arguments[0]);} else {
        const tx = transactions.findOne(_id); check(tx._id, String);
        const newUserId = this.userId ? false : tx.buyerId;
        const usr = Meteor.users.findOne(tx.buyerId);
        if(!newUserId) { check(usr, Object); }

        const biz = businessProfiles.findOne(tx.sellerId); check(biz._id, String);
        if(!_.contains(biz.habitat, habId) || usr && habId !== usr.profile.habitat ){
          throw new Meteor.Error('503', 'Unauthorized update');
        } else if(this.userId && !mappr.student.isInsideHabitat(geometry)) {
          throw new Meteor.Error('503', 'Unauthorized location for current habitat');
        } else {
          // TODO: delivery and tip reflect in final page?
          transactions.update(tx._id, {$set:
            _.extend(_.omit(arguments[0], '_id'), {
            method: 'Delivery',
            tip: Settings.findOne({name: 'globalTipAmount'}).amount,
          }) }, (e) => { if (e) { throwError( e.message ); }
          });
          return { _id: tx._id };
        }
      }
    }
  }),

  addRunnerInstructions: new ValidatedMethod({
    name: 'transactions.methods.addRunnerInstructions',
    validate: new SimpleSchema({
      txId: { type: String },
      inst: { type: String },
    }).validator(),
    run({txId, inst}) {
      const tx = transactions.findOne(txId);
      if(!this.userId) { throwError('Must be logged in to add instructions'); }
      if(this.userId !== tx.buyerId) { throwError('Buyer ID does not match userId'); }
      if(tx.status !== 'created') { throwError('Transaction already in progress'); }

      transactions.update(txId, {$set: {deliveryInstructions: inst}}, (err) => {
        if(err) { throwError(err.message); }
      });
    }
  }),

  setTip: new ValidatedMethod({
    name: 'transactions.methods.setTip',
    validate: new SimpleSchema({
      txId: { type: String },
      tip: { type: Number, decimal: true, min: 0, max: 50 }
    }).validator(),
    run({ txId, tip }) {
      const tx = transactions.findOne(txId); check(tx, Object);
      const usr = Meteor.user();
      if(tx.buyerId !== usr._id || tx.status !== 'created') { throw new Meteor.Error(503, 'methods.setTip.statusOrUserIdWrong'); }

      return transactions.update(tx._id, { $set: { 'payRef.tip': calc._roundToTwo(tip) } }, (err) => {
        if(err) { throw new Meteor.Error(err.message); }
        return tx._id;
      });

    }
  }),

  addPromo: new ValidatedMethod({
    name: 'transactions.methods.addPromo',
    validate: new SimpleSchema({
      promoId: { type: String },
      txId: { type: String }
    }).validator(),
    run({ promoId, txId }) {
      return Instances.addToTx(promoId, txId);
    }
  }),

  rate: new ValidatedMethod({
    name: 'transactions.methods.rate',
    validate: new SimpleSchema({
      txId: { type: String },
      deliveryRating: { type: Number, optional: true, min: 1, max: 5  },
      vendorRating: { type: Number, optional: false, min: 1, max: 5  },
      rateMessage: { type: String, optional: true },
      canSubmit: { type: Boolean, optional: false, allowedValues: [true] } //TODO: why passing canSubmit up here?
    }).validator(),
    run({ txId, deliveryRating, vendorRating, rateMessage, canSubmit }) {
      if(!this.isSimulation){
        if(vendorRating <= 3 || deliveryRating <= 3){
          sendLowRatingAlert(arguments[0]); //passing 4/5 params, might as well send all args
        }
      }
      const txCursor = transactions.find(txId, {limit: 1});
      const txSet = {
        $set: {
          rating: (deliveryRating ? deliveryRating : false),
          rating_vendor: vendorRating,
          message: rateMessage
        }
      };

      //we'll append the newly calculated averages to initial query, return at end
      let returnObj = txSet;

      const txUpdate = transactions.update({_id: txId}, txSet, (err) => {
        if(err) { throw new Meteor.Error(err.message); } else {
          const vendorRatings = transactions.find({
            sellerId: txCursor.fetch()[0].sellerId,
            rating_vendor: { $gte: 1 }
          }, {fields: {rating_vendor: 1}});

          var newVendorAverage;
          if(!vendorRatings.count()){
            newVendorAverage = vendorRating;
          } else {
            newVendorAverage = getRatingSum(vendorRatings.fetch(), 'rating_vendor') / vendorRatings.count();  //average rating
          }
          check(newVendorAverage, Number);
          const vendorUpdate = businessProfiles.update(txCursor.fetch()[0].sellerId, {
            $set: { rating_vendor: newVendorAverage }
          }, (err) => {
            if(err) { throw new Meteor.Error(err.reason); } else {
              returnObj.newVendorAverage = newVendorAverage;
            }
          });
          //if delivery, sum runner new averate and update
          if(deliveryRating && txCursor.fetch()[0].method === 'Delivery') {
            const runnerRatings = transactions.find({
              runnerId: txCursor.fetch()[0].runnerId,
              rating: { $gte: 1 }
            }, {fields: { rating: 1 } });

            //if first tx, average is the value of first delivery rating
            var newRunnerAverage;
            if(!runnerRatings.count()){
              newRunnerAverage = deliveryRating;
            } else {
              newRunnerAverage = parseFloat( getRatingSum(runnerRatings.fetch(), 'rating') / runnerRatings.count() );
            }
            const runnerUpdate = Meteor.users.update({
              _id: txCursor.fetch()[0].runnerId}, {
              $set: { 'profile.avgRating': newRunnerAverage },
            }, (err) => {
              if(err) { throw new Meteor.Error(err.reason); } else {
                returnObj.newRunnerAverage = newRunnerAverage;
              }
            });
          }

        }
      });

      return returnObj;
    }
  }),

  emergencyRunnerPing: new ValidatedMethod({
    name: 'transactions.methods.emergencyRunnerPing',
    validate: new SimpleSchema({
      txId: { type: String },
      amount: { type: Number, decimal: true, }
    }).validator(),
    run({ txId, amount }) {
      tx = transactions.findOne(txId);
      hab = Habitats.findOne(tx.habitat);
      transactions.update(txId, {$set: {
        'runnerPayRef': {
          onDemand: true,
          onDemandRate: amount,
        }
      }}, (err) => { if (err) throwError(err.message); });
      if(!this.isSimulation){return sendEmergencyPing(tx, hab._id, amount);}
    }
  }),
};

sendEmergencyPing = (tx, habId, amount) => {
  const hab = Habitats.findOne(habId);
  tip =tx.payRef.tip ? '+ ' + accounting.formatMoney(tx.payRef.tip) + ' tip' : '';
  msg = `Payout: ${accounting.formatMoney(amount)}
New on-demand order #${tx.orderNumber} in ${hab.name} for ${tx.company_name}. Respond with the order number to accept`;
  const numbers = Meteor.users
    .find({roles: {$in: ['runner']}, 'profile.runHabitats': {$in: [habId]}})
    .map(u => u.profile.phone);
    numbers.forEach((phoneNumber) => {
      twilio.messages.create({
        to: '+1' + phoneNumber,
        from: Meteor.settings.twilio.twilioPhone,
        body: msg,
      }, (err, res) => {});
    });

};

Meteor.methods({
  acceptOrder(id, method, role) {
      if(Meteor.isServer){
        const tx = transactions.findOne(id);
        transactions.update(id, {$set: {
          acceptedByVendor: role === 'vendor',
          acceptedByAdmin: role === 'admin',
          acceptedAt: new Date(),
          acceptedBy: this.userId,
        }}, (err, res) => {
          if(err){ throwError(err.message); }
          if (!tx.DaaS) {
            DDPenv().call('sendUserReceiptEmail', id, (err, res));
          }
          if(tx.promoId) { Instances.redeem(tx.promoId, tx.buyerId, true); }
          if(!tx.DaaS && tx.payRef.platformRevenue > 0){
            DDPenv().call("submitForSettlement", tx.braintreeId, tx.payRef.platformRevenue, (err, res) => {
              if(err) { throw new Meteor.Error(err.message); }
            });
          }

        });
      }
      return method === "Pickup" ? transactions.methods.acceptPickup.call({txId: id}) :
        transactions.methods.acceptDelivery.call({txId: id});
    },
    generateOrderAgainTransaction(oldTx){
      delete oldTx._id;
      const id = transactions.insert(oldTx);
      console.log(oldTx.method);
      if (oldTx.method !== 'Pickup') {
        transactions.methods.addTxAddress.call({
          _id: id,
          habId: Meteor.user().profile.habitat,
          deliveryAddress: Meteor.user().profile.address ? Meteor.user().profile.address : transactions.findOne({buyerId: Meteor.userId()}).deliveryAddress,
          geometry: Meteor.user().profile.geometry
        }, (err) => { if(err) { throwError(err.message); }});
      }
      return id;
    },
    updatePrepTime(tx, time) {
      const tran = transactions.findOne(tx);
      const biz = businessProfiles.findOne(tran.sellerId);
      const usr = Meteor.users.findOne(this.userId);
      if (biz._id === usr.profile.businesses[0] || Meteor.user().roles.includes('admin')) {
        transactions.update(tx, {$set: {prepTime: time, readyAt: new Date(Date.now() + (time * 60000))}});
      }
    },
    confirmPickupTime(tx) {
      const item = transactions.findOne(tx);
      if (item.runnerId === Meteor.userId()) {
        transactions.update(tx, {$set: {pickedUpAt: Date.now()}});
      }
    },
    requestRemoteDaas(obj) {
      transactions.methods.searchForAddress.call({address: obj.address}, (err, res) => {
        if (res && res.features.length) {
          transactions.methods.insertDaaS.call({
            deliveryAddress: res.features[0].place_name,
            loc: res.features[0].geometry,
            sellerId: Meteor.users.findOne(this.userId).profile.businesses[0],
            DaaSType: obj.type
          }, (err, id) => {
            if (err) {
              throw new Meteor.Error(err);
            }
            const txId = id;
            transactions.methods.requestDaaS.call({
              deliveryId: id,
              prepTime: obj.time,
              customerName: obj.name,
              customerPhone: obj.phone
            }, (err, id) => {
              if (err) {
                throw new Meteor.Error(err);
              } else {
                const charge = businessProfiles.getToday(Meteor.users.findOne(this.userId).profile.businesses[0]).vendorRates.DaaS.flat;
                transactions.update(txId, {$set: {'payRef.DaaSCharge': charge}});
              }
            });
          });
        } else {
          throw new Meteor.Error('Invalid Address');
        }
      });
    },
    editDaaSInfo(id, state) {
      const obj = {
        customerName: state.name,
        customerPhone: state.phone,
        deliveryAddress: state.address
      };
      if (transactions.findOne(id).sellerId === Meteor.users.findOne(this.userId).profile.businesses[0]) {
        return transactions.update(id, {$set: obj});
      }
    },
    searchRemoteDaas(addr) {
      let results;
      transactions.methods.searchForAddress.call({address: addr}, (err, res) => {
        if (res && res.features.length) {
          results = mappr.shared.filterAddresses(err, res).map(r => ({address: r.place_name}));
        }
      });
      return results;
    },
    setTransactionClosed(id) {
      if (this.userId) {
        if (transactions.findOne(id).sellerId === Meteor.users.findOne(this.userId).profile.businesses[0]) {
          transactions.update(id, {$set: {closed: true}});
        } else {
          return new Meteor.Error('Unauthorized');
        }
      }
    },
    remoteVendorContact(txId, apiKey) {
      console.log(this.userId);
      if (APIKeys.findOne({key: apiKey}) || this.userId && Meteor.users.findOne(this.userId).roles.includes('admin')) {
        handleInitialVendorContact(txId, apiKey);
      }
    },
    alertRunnerReady(txId) {
      const tx = transactions.findOne(txId);
      if (tx.sellerId === Meteor.users.findOne(this.userId).profile.businesses[0]) {
        const runnerPhone = Meteor.users.findOne(tx.runnerId).profile.phone;
        if (!runnerPhone) { return 'no runner'; }
        const msg = `Order #${tx.orderNumber} from ${tx.company_name} is ready for pickup`;
        transactions.update(txId, {$set: {readyTextSent: true}});
        twilio.messages.create({
          to: runnerPhone, // Any number Twilio can deliver to
          from: Meteor.settings.twilio.twilioPhone, // A number you bought from Twilio and can use for outbound communication
          body: msg,
        }, (err, responseData) => {
            if (!err) {
              console.log(responseData.body);
            } else {
              //invalid number
              if(err.code === 21211) {
                const parsedWrongNum = err.message.match(/[0-9]+/)[0];
                console.log(`Message 'sent to invalid number - ${parsedWrongNum}'`);
              } else {
                console.log(err);
              }
            }
          }
        );
      }
    }
});


getRatingSum = function(collection, key){
  return _.reduce(_.pluck(collection, key), (memo, num) => {
      return parseFloat(memo) + num;
  });
};