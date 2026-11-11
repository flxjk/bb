const {
  AndroidConfig,
  withAndroidManifest,
  withInfoPlist,
} = require("expo/config-plugins");

const disabledAndroidFlags = [
  "firebase_messaging_auto_init_enabled",
  "firebase_analytics_collection_enabled",
];

const disabledIosFlags = [
  "FirebaseAnalyticsCollectionEnabled",
  "FirebaseAutomaticScreenReportingEnabled",
  "FirebaseMessagingAutoInitEnabled",
];

module.exports = function withPushConsent(config) {
  const withAndroid = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      mod.modResults,
    );
    for (const name of disabledAndroidFlags) {
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(
        application,
        name,
        "false",
      );
    }
    return mod;
  });
  return withInfoPlist(withAndroid, (mod) => {
    for (const name of disabledIosFlags) {
      mod.modResults[name] = false;
    }
    return mod;
  });
};
