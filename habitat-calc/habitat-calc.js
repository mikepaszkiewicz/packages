//init submodule
calc = {
  _checkDecimalPlace (num) {
    //http://stackoverflow.com/questions/10454518/javascript-how-to-retrieve-the-number-of-decimals-of-a-string-number
    const match = (''+num).match(/(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
    return Math.max( 0, (match[1] ? match[1].length : 0) - (match[2] ? +match[2] : 0));
  },
  _roundToTwo(amt) {
    // http://stackoverflow.com/questions/11832914/round-to-at-most-2-decimal-places-in-javascript
    const rounded = (Math.round(amt * 100) / 100);
    if(this._checkDecimalPlace(rounded) > 2) { throw new Meteor.Error(503, '_roundToTwo.gtTwo'); }
    return rounded;
  },
  _totalPrice(tp){
    return calc._roundToTwo(tp);
  },
  orderTotal(order) {
    return this._roundToTwo(order.map((order) => {
      return order.itemPrice +
        Modifiers.find({_id: {$in: _.flatten(order.modifiers)}}).fetch().reduce((sum, id) => {
          return sum + Modifiers.findOne(id).price;
        }, 0);
      }).reduce((num, sum) => { return num + sum; }, 0));
  },
  _customerCommission(tp){ return this._roundToTwo(tp * 0.05); },
  _mealServiceCharge(tp){ return this._roundToTwo((tp * 0.029) + 0.30); },
  _tip(tx){ return tx.payRef && tx.payRef.tip ? tx.payRef.tip : 0; },
  _promoAmount(tx){ return Instances.getPromoValue(tx.sellerId, tx.promoId); },
  _deliveryFee(tx){
    const today = businessProfiles.getToday(tx.sellerId);
    if (!today.vendorPremium) { return today.deliveryFee; } else {
      const deliveryFee = today.deliveryFeeMinimumFallback; //it's premium, so deliveryFee for today is 0. need to look at the day's minimumFallbackFee
      const diff = today.vendorRates.freeDel.minimum - tx.payRef.tp; //get the difference between the free delivery minimum and totalPrice
      return diff < 0 ? 0 : deliveryFee;
    }
  },
  meal: {
    mealCountDefault: 1,
    deliveryCountDefault: 1,
    mealPrice: 8,
    mealTotal(meal_count) { return (this.mealPrice * meal_count); },
    subtotal(meal_count){ return this.mealTotal(meal_count); },
    serviceCharge(meal_count){ return calc._mealServiceCharge(this.subtotal(meal_count)); },
    platformRevenue(meal_count){ return calc._roundToTwo( this.subtotal(meal_count) + this.serviceCharge(meal_count) ); },
    getPayRef(meal_count){
      return {
        mealCount: meal_count,
        subtotal: this.subtotal(meal_count),
        serviceCharge: this.serviceCharge(meal_count),
        platformRevenue: this.platformRevenue(meal_count),
      };
    }
  },
  platformRevenue: {
    pickup(tp){
      return calc._roundToTwo(
        calc._totalPrice(tp) +
        calc.tax(tp) +
        calc.serviceCharge.pickup
      );
    },
    delivery(tp, tx){
      const prePromo = tp + calc._deliveryFee(tx) + calc._tip(tx) + calc.tax(tp);
      if ((prePromo - calc._promoAmount(tx)) < 0) {
        return 0;
      } else {
        return calc._roundToTwo(prePromo - calc._promoAmount(tx));
      }
    }
  },
  serviceCharge: { pickup: 0.50, },
  tax(tp){ return tp * this.taxRate; },
  needToRecalculate(diff){
    return diff.order || diff.method || diff.promoId ||
      ( diff.payRef && diff.payRef.tip ||
        diff.payRef && diff.payRef.tip === 0
      );
  },
  recalculateOpenTxs(id, diff) {
    if(this.needToRecalculate(diff)) {
      const tx = transactions.findOne(id); if(!tx) { throw new Meteor.Error(id + 'Sorry, tx god deleted or is being updated and not there'); }
      if(!tx.DaaS && !tx.thirdParty) {
        Meteor.call('recalcPayRef', id, (err) => {
          if(err) { throw new Meteor.Error(err.message); }
        });
      }
    }
  },
  getPayRef(txId){
    check(txId, String);
    const tx = transactions.findOne(txId);
    const totalPrice = this.orderTotal(tx.order);
    switch (tx.method) {
      case 'Pickup':
        const pickupMealAmount = this.calcMealAmount(this.platformRevenue.pickup(totalPrice), tx);
        return {
          tp: totalPrice,
          tax: this.tax(totalPrice),
          chargeFee: this.serviceCharge.pickup,
          platformRevenue: !pickupMealAmount ? this.platformRevenue.pickup(totalPrice) : pickupMealAmount.diff,
          mealInfo: !pickupMealAmount ? null : pickupMealAmount,
        };
      case 'Delivery':
        const deliveryMealAmount = this.calcMealAmount(this.platformRevenue.delivery(totalPrice, tx), tx);
        const payRef = {
          tp: totalPrice,
          tax: this.tax(totalPrice),
          deliveryFee: this._deliveryFee(tx),
          promoAmount: this._promoAmount(tx),
          chargeFee: 0,
          tip: this._tip(tx),
          platformRevenue: !deliveryMealAmount ? this.platformRevenue.delivery(totalPrice, tx) : deliveryMealAmount.diff,
          mealInfo: deliveryMealAmount ? deliveryMealAmount : null
        };
        return payRef;
      default: //method is not set, default to pickup
        return {
          tp: totalPrice,
          tax: this.tax(totalPrice),
          chargeFee: this.serviceCharge.pickup,
          platformRevenue: !pickupMealAmount ? this.platformRevenue.pickup(totalPrice) : pickupMealAmount.diff,
          mealInfo: !pickupMealAmount ? null : pickupMealAmount,
        };
      }
  },

  calcMealAmount(total, tx) {
    const usr = Meteor.users.findOne(tx.buyerId);
    const usersMeals =  usr ? usr.profile.mealCount : null;
    if (usersMeals) {
      const bigCt = usersMeals * 8;
      const newBigCt = bigCt - total;
      if (newBigCt > 0) {
        const rounded = Math.round((newBigCt / 8) * 10) / 10;
        return {
          used: Number((usersMeals - rounded).toFixed(1)),
          new: rounded,
          diff: 0
        };
      } else {
        return {
          used: Number(usr.profile.mealCount),
          new: 0,
          diff: Math.abs(newBigCt)
        };
      }
    } else {
      return false;
    }
  },
  weeks: {
    _weekQuery(bizId, weekNum){
      const query = {
       week: parseInt(weekNum),
       sellerId: bizId ,
       $or: [
        { missedByVendor: true },
        { cancelledByVendor: true },
        { cancelledByAdmin: true },
        { status: { $in: [ 'completed', 'archived' ] }},
       ]
     };
       return query;
    },
    _completed(bizId, weekNum){
      console.log(weekNum);
      txs = transactions.find(this._weekQuery(bizId, weekNum), {sort: { timeRequested: 1 }}).fetch()
        .filter(tx => !tx.missedByVendor)
        .filter(tx => !tx.cancelledByVendor)
        .filter(tx => !tx.cancelledByAdmin);
      return txs;
    },
    _missed(bizId, weekNum){
      transactions.find(this._weekQuery(bizId, weekNum), {sort: { timeRequested: 1 }}).fetch()
        .filter(tx => tx.missedByVendor)
        .filter(tx => tx.cancelledByVendor)
        .filter(tx => tx.cancelledByAdmin);
    },
    _all(bizId, weekNum) {
      return transactions.find(this._weekQuery(bizId, weekNum), {sort: { timeRequested: -1 }}).fetch();
    },
    getAllWeeks(bizId) {
      return weeks.find({}, {sort: {week: 1}}).map(week => this.getWeek(bizId, week, counts=true));
    },
    getWeek(bizId, weekNum, counts){
      //always filter what vendor sees by these
      console.log(weekNum);
      console.log(typeof weekNum);

      const week = weeks.findOne({week: parseInt(weekNum)});
      console.log(week._id);
      return {
        transactions: !counts ? this._all(bizId, weekNum) : this._all(bizId, weekNum).length,
        potentialTransactions: !counts ? this._missed(bizId, weekNum) :
          this._missed(bizId, weekNum) ? this._missed(bizId, weekNum).length : 0,
        completedTransactions: !counts ? this._completed(bizId, weekNum) : this._completed(bizId, weekNum).length,
        subtotal: {
          deliveryOrders: this._completed(bizId, weekNum)
            .filter(t => !t.DaaS)
            .filter(t => t.method === 'Delivery')
            .reduce((total, tx) => { return total + tx.vendorPayRef.totalPrice; }, 0),
          pickupOrders: this._completed(bizId, weekNum)
            .filter(t => !t.DaaS)
            .filter(t => t.method === 'Pickup')
            .reduce((total, tx) => { return total + tx.vendorPayRef.totalPrice; }, 0),
          orders: this._completed(bizId, weekNum)
            .filter(t => !t.DaaS)
            .reduce((total, tx) => { return total + tx.vendorPayRef.totalPrice; }, 0),
          DaaS: this._completed(bizId, weekNum)
            .filter(t => t.DaaS)
            .reduce((total, tx) => { return total + tx.vendorPayRef.totalPrice; }, 0),
        },
        payout: {
          deliveryOrders: this._completed(bizId, weekNum)
            .filter(t => !t.DaaS)
            .filter(t => t.method === 'Delivery')
            .reduce((total, tx) => { return total + tx.vendorPayRef.vendorPayout; }, 0),
          pickupOrders: this._completed(bizId, weekNum)
            .filter(t => !t.DaaS)
            .filter(t => t.method === 'Pickup')
            .reduce((total, tx) => { return total + tx.vendorPayRef.vendorPayout; }, 0),
          orders: this._completed(bizId, weekNum)
            .filter(t => !t.DaaS)
            .reduce((total, tx) => { return total + tx.vendorPayRef.vendorPayout; }, 0),
          DaaS: this._completed(bizId, weekNum)
            .filter(t => t.DaaS)
            .reduce((total, tx) => { return total + tx.vendorPayRef.vendorPayout; }, 0),
        },
        startTime: moment(week.startTime).format(),
        endTime: moment(week.endTime).format(),
        start: week.startTime,
        end: week.endTime,
      };
    },
  },
  creditsForAcquisition: 0.625,
  cancelCredits: 0.125,
  taxRate: 0.08,
};