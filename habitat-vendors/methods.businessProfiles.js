businessProfiles.methods = {
  onboard: new ValidatedMethod({
    name: 'businessProfiles.methods.onboardSubmerchant',
    validate: new SimpleSchema({
      merchAcct: { type: Object, blackbox: true },
      sid: {type: String}
    }).validator(),
    run({ merchAcct, sid }) {
      if (!this.isSimulation && Roles.userIsInRole(this.userId, ['vendor']) ||
          !this.isSimulation && Roles.userIsInRole(this.userId, ['admin']) ) {
        BT.submerchant.create(merchAcct, sid, (err, success) => {
          if(err){ throw new Meteor.Error(err.message); }
          return success;
        });
      }
    }
  }),

  create: new ValidatedMethod({
    name: 'businessProfiles.methods.create',
    validate: new SimpleSchema({
      habitat: { type: [String] },
      company_name: { type: String },
      company_email: { type: String },
      company_phone: { type: String },
      company_address: { type: String },
      orderPhone: { type: String },
      company_type: { type: String },
      company_picture: { type: String },
      method: { type: String },
      notificationPreference: { type: String },
      prep_time: { type: Number },
    }).validator(),
    run() {
      if (!Roles.userIsInRole(Meteor.userId(), ['admin'])) {
        throw new Meteor.Error('501', 'Please sign in as an admin');
      } else {
        return businessProfiles.insert(arguments[0], (err) => {
          if(err) { throwError(err.message); } else {
            return id;
          }
        });
      }
  }
  }),

  rearrangeCategories: new ValidatedMethod({
    name: 'businessProfiles.methods.rearrangeCategories',
    validate: new SimpleSchema({
      bizId: { type: String },
      newCatArray: { type: [String]  },
    }).validator(),
    run({ bizId, newCatArray }) {
      if (!this.isSimulation && Roles.userIsInRole(this.userId, ['vendor']) ||
          !this.isSimulation && Roles.userIsInRole(this.userId, ['admin']) ) {

        return businessProfiles.update(bizId, {$set: { categories: newCatArray }}, (err) => {
          if(err) { throw new Meteor.Error(err.message); } else {
            return businessProfiles.findOne(bizId).categories;
          }
        });
      }
    }
  }),

  addMenuItem: new ValidatedMethod({
    name: 'businessProfiles.methods.addMenuItem',
    validate: new SimpleSchema({
      uid: { type: String },
      name: { type: String },
      description: { type: String },
      category: { type: String },
      price: { type: Number, decimal: true},
      modifiers: { type: [String] },
    }).validator(),
    run({uid}) {
      if (Meteor.user() && Roles.userIsInRole(Meteor.userId(), ['admin', 'vendor'])) {
        return saleItems.insert(arguments[0]);
      } else {
        throwError('Unauthorized');
      }
    }
 })
};

Meteor.methods({
  setVendorTax(biz, type) {
    if (Meteor.users.findOne(this.userId).roles.includes('admin')) {
      businessProfiles.update(biz, {$set: {tax: type}});
    }
  }
});