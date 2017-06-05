businessProfiles.schema = new SimpleSchema({
  _id: { type: String, regEx: SimpleSchema.RegEx.Id },
  habitat: { type: [String], regEx: SimpleSchema.RegEx.Id },
  company_name: { type: String, trim: true },
  company_email: { type: String, regEx: SimpleSchema.RegEx.Email },
  company_phone: { type: String, trim: true, max: 10 },
  company_address: { type: String, trim: true },
  orderPhone: { type: Number },
  twilioPhone: { type: String, optional: true},
  DaaS: { type: Boolean, optional: true},
  backend_name: { type: String, optional: true },
  backend_habitat: { type: String, optional: true },
  rating_vendor: { type: Number, optional: true, decimal: true },
  faxPhone: { type: Number, optional: true },
  company_type: { type: String, trim: true, allowedValues: ['Fast Casual', 'Food Truck', 'Dine In'] },
  company_picture: { type: String, trim: true },
  prep_time: { type: Number, min: 0, max: 45, defaultValue: 15 },
  method: { type: String, trim: true, allowedValues: ['pickup', 'delivery', 'none'] },
  notificationPreference: { type: String, trim: true, optional: false, allowedValues: ['sms', 'email', 'fax', 'app', 'receipt printer'] },
  production: { type: Boolean, autoValue(){ return this.isInsert && !Meteor.settings.devMode; } },
  uid: { type: String, regEx: SimpleSchema.RegEx.Id, optional: true },
  open: { type: Boolean },
  merchantId: { type: String, optional: true },
  submerchantApproved: { type: Boolean, optional: true, },
  tax: { type: Boolean, optional: true },
  featured: { type: Boolean },
  clicks: { type: Number },
  categories: { type: [String], trim: true, optional: true },
  transactionCount: { type: Number },
  order: { type: Number, optional: true, min: 0 },
  geometry: { type: Object, blackbox: true, },
  direct_deposit: { type: Boolean, optional: true},
  catering: { type: Boolean, optional: true},
  habitat_exclusive: { type: Boolean, optional: true},
  habitatOwnsTablet: { type: Boolean, optional: true},
  serialNumber: { type: Number, optional: true},
  ownerPhone: {type: String, optional: true },

  employees: { type: [Object], optional: true },
    'employees.$.name': { type: String },
    'employees.$.phone': { type: Number },
    'employees.$.text': { type: Boolean },

  zones: { type: [Object], optional: true },
    'zones.$.name': { type: String },
    'zones.$.multiplier': { type: Number, decimal: true },
    'zones.$.min': { type: Number, decimal: false },
    'zones.$.max': { type: Number, decimal: false },

  radius: { type: Array, optional: true },
  'radius.$': {type: Array, optional: true},
  'radius.$.$': {type: Number, decimal: true, optional: true},

  weeklyHours: { type: [Object], },
    'weeklyHours.$.day': { type: Number, allowedValues: [0,1,2,3,4,5,6] },
    'weeklyHours.$.open': { type: Boolean },
    'weeklyHours.$.openHr': { type: String, trim: true },
    'weeklyHours.$.closeHr': { type: String, trim: true },
    'weeklyHours.$.openTime': { type: Number },
    'weeklyHours.$.closeTime': { type: Number },
    'weeklyHours.$.quickClose': { type: Number, optional: true },
    'weeklyHours.$.vendorPremium': { type: Boolean, },
    'weeklyHours.$.deliveryFeeMinimumFallback': { type: Number, decimal: true, min: 0, max: 100, defaultValue: 3 },
    'weeklyHours.$.deliveryFee': { type: Number, decimal: true },
    'weeklyHours.$.vendorRates': { type: Object, },
    'weeklyHours.$.vendorRates.DaaS': { type: Object },
    'weeklyHours.$.vendorRates.DaaS.flat': { type: Number, decimal: true, min: 0, max: 100 },
    'weeklyHours.$.vendorRates.DaaS.percent': { type: Number, decimal: true, min: 0, max: 1 },
    'weeklyHours.$.vendorRates.delivery': { type: Object },
    'weeklyHours.$.vendorRates.delivery.flat': { type: Number, decimal: true, min: 0, max: 100 },
    'weeklyHours.$.vendorRates.delivery.percent': { type: Number, decimal: true, min: 0, max: 1 },
    'weeklyHours.$.vendorRates.freeDel': { type: Object },
    'weeklyHours.$.vendorRates.freeDel.flat': { type: Number, decimal: true, min: 0, max: 100 },
    'weeklyHours.$.vendorRates.freeDel.percent': { type: Number, decimal: true, min: 0.0, max: 1 },
    'weeklyHours.$.vendorRates.freeDel.minimum': { type: Number, decimal: true, min: 0, max: 100, defaultValue: 10 },
    'weeklyHours.$.vendorRates.pickup': { type: Object },
    'weeklyHours.$.vendorRates.pickup.flat':  { type: Number, decimal: true, min: 0.0, max: 1 },
    'weeklyHours.$.vendorRates.pickup.percent':  { type: Number, decimal: true, min: 0.0, max: 1 },
}); businessProfiles.attachSchema(businessProfiles.schema);
