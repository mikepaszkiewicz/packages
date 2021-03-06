import { _ } from 'underscore';
import SimpleSchema from 'simpl-schema';
tx = txId => transactions.findOne(txId);
longCall = Meteor.isDevelopment ? 40000 : 120000;
shortCall = Meteor.isDevelopment ? 40000 : 90000;
finalDelay = Meteor.isDevelopment ? 40000 : 90000;

class transactionsCollection extends Mongo.Collection {
  insert(doc) {
    const bizProf = businessProfiles.findOne(doc.company_name ?
      { company_name: doc.company_name} :
      doc.sellerId
    );
    const txWeek = (doc.deliverBy > moment().day(7).hour(23).minute(59).valueOf()) ? weeks.find().count() + 1 : weeks.find().count();
    const usr = Meteor.users.findOne(doc.buyerId) || false;
    return super.insert(_.extend(this.resetItems(), {
      status: doc.status || 'created',
      DaaS: doc.DaaS ? true : false,
      thirdParty: doc.thirdParty || false,
      partnerName: doc.partnerName,
      acceptUrl: doc.acceptUrl,
      payRef: doc.payRef || {},
      closed: false,
      DaaSType: doc.orderType || doc.DaaSType,
      vendorPayRef: businessProfiles.rates(tx._id),
      runnerPayRef: {},
      prepTime: doc.prepTime || doc.prep_time || bizProf.prep_time,
      order: (!doc.order || !doc.order.length) ? [] : this.formatOrder(doc.order, doc.thirdParty),
      plainOrder: doc.plainOrder,
      orderNumber: doc.orderNumber || this.pin(),
      orderSize: doc.orderSize || 1,
      habitat: doc.habitat || bizProf.habitat[0],
      method: doc.method ? doc.method : doc.isDelivery ? 'Delivery' : 'Pickup',
      deliveryAddress: doc.deliveryAddress || '',
      deliveryInstructions: doc.deliveryInstructions,
      geometry: doc.loc, //where the order is getting delivered to
      company_address: bizProf.company_address,
      company_name: bizProf.company_name,
      company_geometry: bizProf.geometry,
      company_phone: bizProf.orderPhone,
      buyerId: !doc.DaaS ? doc.buyerId : doc.sellerId,
      customer: this.customerItems(usr, doc),
      sellerId: bizProf._id,
      createdAt: Date.now(),
      createdAtHuman: new Date(),
      timeRequested: 0,
      humanTimeRequested: 0,
      vendorCallCount: 0,
      latestVendorCall: 0,
      settledByAdmin: null,
      problem: false,
      rating: null,
      message: null,
      rating_vendor: null,
      week: txWeek,
      scheduled: doc.scheduled,
      deliverBy: doc.deliverBy,
      catering: doc.catering ? doc.catering : false,
      externalId: doc.externalId || false,
      externalVendorId: doc.externalVendorId || false,
    }), (err, txId) => {
      tx = transactions.findOne(txId);
      if(err) { throwError(err.message); } else {
        if(tx.method === 'Delivery') {
          this.addRouteInfo(txId)
        }
        if(tx.status === 'pending_vendor' || tx.status === 'pending_runner'){
          transactions.request(txId, {});
          if (tx.status === 'pending_runner' && Settings.findOne({name: 'pendingDispatch'}).is) {
            transactions.update(txId, {$set: {status: 'pending_dispatch'}});
          }
        }
        if (tx.scheduled && tx.status === 'queued') {
          transactions.update(tx._id, {$set: {deliveredAtEst: tx.deliverBy, vendorPayRef: businessProfiles.rates(tx._id)}});
          Alerts.methods.warnScheduled(tx, true); }
        if(doc.buyerId){ Meteor.users.update(doc.buyerId, { $push:{ "profile.transactions": txId } }); }
        return txId;
      }
    });
  }
  validate(order){
    let schema = _baseSchema.extend(_customerSchema).extend(_timingSchema).extend(_deliverySchema).extend(_payRefSchema);
    if (order.plainOrder && order.plainOrder.length) { schema.extend(_orderSchema);}
    if(order.method === 'Delivery' || order.isDelivery){ order = _.extend(order, handleDelivery(order)); }
    const cleanDoc = schema.clean(order);
    schema.validate(cleanDoc);
    return cleanDoc;
  }
  forceInsertSingle(doc){ if(!transactions.findOne(doc._id)){ return super.insert(doc); } }
  forceInsert(txs) { return transactions.batchInsert(txs, (err) => { if(err) { throwError(err.message); } else { } }); }
  forceRemove() { return super.remove({}); }
  formatOrder(order, thirdParty){
    if(!thirdParty){
      if (order.length === 0) {
        o = order;
      } else {
        o = [];
        const out = this;
        _.each(order, function(orderObj) {
          const saleObj = saleItems.findOne(orderObj.saleItemId);
          if (saleObj) {
            _.extend(orderObj, {
             orderId: out.pin(),
             itemPrice: saleObj ? saleObj.price : 0,
             itemName: saleObj ? saleObj.name : '',
             itemCategory: saleObj.category || undefined,
             modifiersText: orderObj.modifiers === [] ? [] : out.formatMods(orderObj.modifiers)
           });
          }
         o.push(orderObj);
        });
      }
    } else {
      o= order.length === 0 ? order : order.map(order =>
         _.extend(order, {
          orderId: this.pin(),
          itemPrice: order.itemPrice,
          itemName: order.itemName,
          modifiers: order.modifiers
        })
      );
    }

    return o;
  }
  formatMods(mods) {
    let modArray = [];
    for (i = 0; i < mods.length; i++) {
      var mod = Modifiers.findOne(mods[i]);
      if (mod) {
        modArray.push({
          name: mod.name,
          category: modCategories.findOne(mod.subcategory) ? modCategories.findOne(mod.subcategory).name : null,
          price: mod.price
        });
      }
    }
    return modArray;
  }
  remove(id, callback){ return super.remove(id, callback); }
  //todo: clean up params
  deliveryEstimate(txId, inMinutes, prep, sellerId, habitat, daas){
    let tx = transactions.findOne(txId);
    const bp = businessProfiles.findOne(tx.sellerId || sellerId);
    const prepTime = tx.prepTime || bp.prep_time; //TODO: add prepTime to txs on request so we don't need ternary
    habId = tx.habitat || habitat;
    const delTime = Habitats.findOne(habId).deliveryTime;
    const estimate = inMinutes ?
      prepTime + delTime :
      tx.timeRequested ? tx.timeRequested : Date.now() + (60000 * prepTime) + (60000 * delTime);
    return estimate;
  }
  addRouteInfo(txId, count, i) {
    if(Meteor.isClient){
      console.warn("cant add route info on client");
    } else {
      check(txId, String);
      const tx = transactions.findOne(txId);
      const url = gmapsUrl(txId);
      HTTP.call('GET', url, (err, result) => {
        if(err){ console.warn(err.message); } else {
          if(!result.data.routes.length){
              console.warn(`no routes found for ${txId}`);
          } else {
            dirs = result.data.routes[0];
            if(!dirs.legs.length){
              console.warn(`no legs found for ${txId}`);
            } else {
              journey = dirs.legs[0];
              transactions.update(txId, { $set: {
                routeInfo: {
                  car: {
                    distance: {
                      text: journey.distance.text,
                      meters: journey.distance.value,
                    },
                    duration: {
                      text: journey.duration.text,
                      seconds: journey.duration.value,
                    }
                  }
                }
              } }, (err) => {
                if(err) { console.warn(err.message); }
              });
            }
          }
        }
      });
    }
  }
  getStatus(txId) {
    tx = transactions.findOne(txId);
  }
  requestItems(txId, prepTime, daas) {
    tx = transactions.findOne(txId);
    const isDaaS = daas || transactions.findOne(txId).DaaS;
    const timeReq = Date.now();
    const req = {
      week: weeks.find().count(),
      timeRequested: Date.now(),
      humanTimeRequested: new Date(),
      vendorPayRef: businessProfiles.rates(txId),
      vendorOrderNumber: isDaaS ? null : goodcomOrders.find().count() + 1,
      cronCancelTime: isDaaS ? false : timeReq + longCall + shortCall + shortCall + finalDelay,
      deliveredAtEst: this.deliveryEstimate(txId, inMinutes=false, prepTime),
      pickupAtEst: tx.prepTime ? moment((Date.now() + (tx.prepTime * 60000)) - 14400000).format() : moment().format(),
      cancelledByAdmin: false,
      cancelledByVendor: false,
      missedByVendor: false,
      cancelledTime: false,
    };
    return req;
  }
  scheduledRequestItems(txId) {
    const req = {
      week: weeks.find().count(),
      timeRequested: Date.now(),
      humanTimeRequested: new Date(),
      vendorPayRef: businessProfiles.rates(txId),
      deliveredAtEst: transactions.findOne(txId).deliverBy,
      cancelledByAdmin: false,
      cancelledByVendor: false,
      missedByVendor: false,
      cancelledTime: false,
      status: 'pending_dispatch',
    };
    return req;
  }
  //reset vendor, runner, admin lifecycle. no user related stuff or payRef determining fields
  resetItems(){
    return {
      calledRunner: false,
      cancelledByVendor: false,
      acceptedByVendor: false,
      missedByVendor: false,
      acceptedByAdmin: false,
      acceptedAt: false,
      acceptedBy: false,
      cancelledByAdmin: false,
      settledByAdmin: false,
      dropoffVariationMin: 0,
      adminAssign: false,
      promoUsed: null,
      promoId: null,
      declinedBy: [],
      // deliveredAtEst: false,
    };
  }
  customerItems(usr, doc) {
    if(usr) {
      return { id: usr ? usr._id : '', phone: usr ? usr.profile.phone : '', name: usr ? usr.profile.fn : '', };
    } else if (doc.thirdParty || doc.DaaS) {
      return {
        id: '',
        phone: doc.customer.phone,
        name: doc.customer.name,
        email: doc.customer.email
      };
    }
  }
  request(id, fields, callback){
    const trans = transactions.findOne(id);

    if (trans && trans.payRef && trans.payRef.mealInfo) { Meteor.users.update(trans.buyerId, {$set: {'profile.mealCount': trans.payRef.mealInfo.new}}); }
    const prep = trans.prepTime;
    //CAN'T USE SUPER HERE, WANT TO USE OVERRIDDEN METHOD TO TRACK LAST UPDATE
    return transactions.update(id, {$set: _.extend(fields, this.requestItems(id), {
      txType: trans.promoId ?
        Instances.findOne(trans.promoId) ?
          Instances.findOne(trans.promoId).acquisition ? 'acquisition' : 'retention'
          : ''
        : '',
    })}, (err, res) => {
      if (err) {
        throwError({reason: err.message});
      } else {
        if (!trans.DaaS) {
          console.log(`tx.request.handleInitialVendorContact`);
          handleInitialVendorContact(id);
        } else {
          console.log(`tx.request.notSendingHandleInitial`);
        }
        if(trans.method === 'Delivery'){ runner.updateDropoffInfo(id); }
      }
    });
  }
  timeSinceRequest(txId){
    const tx = transactions.findOne(txId);

    const diff = Math.abs(new Date(tx.dropoffTime) - new Date(tx.timeRequested));
    var minutes = Math.floor((diff/1000)/60);

    return minutes;
  }
  //definitely a more elegant way to handle whether or not it's w/ timeRequested or from now
  belowMinSubtotal(txId){
    const tx = transactions.findOne(txId);
    const today = tx ? businessProfiles.getToday(tx.sellerId) : undefined;

    return tx.method === 'Delivery' &&
      today.vendorPremium &&
      tx.payRef.tp < today.vendorRates.freeDel.minimum;
  }
  notifyVendor(id, callCount, callback){
    //CAN'T USE SUPER HERE, WANT TO USE OVERRIDDEN METHOD TO TRACK LAST UPDATE
    return this.update(id, {$set: {
      latestVendorCall: Date.now(),
      vendorCallCount: callCount + 1
    }}, callback);
  }
  notifyRunner(id, callCount, call){
    return super.update(id, {$set: call ? {
      latestRunnerCall: Date(),
      runnerCallCount: callCount + 1,
    } : {
      textedRunner: true,
      runnerTextTime: Date(),
    }});
  }

  creditsCoverFullOrder(id) {
    return transactions.findOne(id) && transactions.findOne(id).payRef.mealInfo && (transactions.findOne(id).payRef.platformRevenue === 0);
  }
  platRevIsZero(id) { return transactions.findOne(id).payRef.platformRevenue === 0; }
  getPromo(txId){ return Instances.findOne(tx(id).promoId); }

  getComplete(habId, range) {
    return transactions.find({
      habitat: habId,
      status: {$in: transactions.completedAndArchived()},
    }, {sort: {timeRequested: -1}}).fetch().filter((tx) => {
      return moment(tx.timeRequested).isSame(Habitats.closedAtToday(habId), range || 'day');
    });
  }
  getDeclined(habId, range) {
    return transactions.find({
      habitat: habId,
      $or: [
        {declinedByVendor: true},
        {cancelledByVendor: true},
        {cancelledByAdmin: true}
      ],
    }, {sort: {createdAt: -1}}).fetch().filter((tx) => {
      return moment(tx.timeRequested).isSame(Habitats.closedAtToday(habId), range || 'day');
    });
  }
  getIncomplete(habId, range)  {
    return transactions.find({
      habitat: habId,
      status: {$nin: transactions.completedAndArchived()},
    }, {sort: {createdAt: -1}}).fetch().filter((tx) => {
      return moment(tx.createdAt).isSame(Habitats.closedAtToday(habId), range || 'day');
    });
  }
  getAll(habId, range){
    return this.getComplete(habId, range).length + this.getIncomplete(habId, range).length;
  }
  completedAndArchived(){ return [ 'completed', 'archived' ]; }
  active(){ return [ 'pending_vendor', 'pending_runner', 'in_progress', 'pending_dispatch' ]; }
  userVisible() { return ['created', 'pending_vendor', 'pending_runner', 'in_progress', 'completed']; }
  userCart() { return ['created', 'pending_vendor', 'pending_runner', 'in_progress']; }
  closedAndDiscarded() { return ['completed', 'archived', 'discarded', 'cancelled']; }
  pin() { return Math.floor(1000 + Math.random() * 9000); }
  grabRunnerObj(runnerId) {
    const rnr = Meteor.users.findOne(runnerId);
    return {
      phone: rnr.profile.phone,
      pic: `${rnr.profile.profile_pic}-/scale_crop/300x300/center/-/autorotate/yes/`,
      name: rnr.profile.fn
    };
  }
}

transactions = new transactionsCollection("transactions");
if(Meteor.isServer){
  transactions._ensureIndex({
    week: 1,
    sellerId: 1,
    runnerId: 1,
    timeRequested: 1,
    buyerId: 1,
    status: 1,
    habitat: 1,
    company_name: 1,
  });
}

const apiKey = 'AIzaSyCyFtEt80IOFCQ_mgvXDwAFKNNCewjeEWo';

deliveryAddressCoords = (txId) => {
  const coords = transactions.findOne(txId).geometry.coordinates,
        lng = coords[1],
        lat = coords[0];
  return { lng, lat };
};

import geolib from 'geolib';

gmapsUrl = (txId) => {
  check(txId, String);
  const tx = transactions.findOne(txId);
  const biz = businessProfiles.findOne(tx.sellerId);
  const originCoords = biz.geometry.coordinates;

  const origin = `origin=${originCoords[1]},${originCoords[0]}`;
  const coords = deliveryAddressCoords(txId);

  const destination = `destination=${coords.lng},${coords.lat}`;

  compass = geolib.getCompassDirection( {latitude: 52.518611, longitude: 13.408056}, {latitude: 51.519475, longitude: 7.46694444} );
  transactions.update(txId, {$set: { compassDirection: compass }});

  const stopsAlongTheWay = false;
  const wayPoints = !stopsAlongTheWay ? '' : `&waypoints=optimize:true|${stopsAlongTheWay}`;
  const url = `https://maps.googleapis.com/maps/api/directions/json?${origin}&${destination}${wayPoints}&key=${apiKey}`;
  return url;
};
