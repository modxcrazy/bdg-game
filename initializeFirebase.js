const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

// Initialize sample services
const services = {
  "instagram_followers": {
    name: "Instagram Followers (Real)",
    category: "Instagram",
    min: 100,
    max: 50000,
    rate: 2.50,
    speed: "1k/day",
    description: "High quality real followers"
  },
  "youtube_views": {
    name: "YouTube Views (High Retention)",
    category: "YouTube",
    min: 1000,
    max: 500000,
    rate: 1.20,
    speed: "10k/day",
    description: "High retention views"
  },
  "facebook_likes": {
    name: "Facebook Page Likes",
    category: "Facebook",
    min: 100,
    max: 100000,
    rate: 3.00,
    speed: "5k/day",
    description: "Real page likes"
  }
};

db.ref('services').set(services)
  .then(() => {
    console.log("Services initialized successfully");
    process.exit(0);
  })
  .catch(error => {
    console.error("Error initializing services:", error);
    process.exit(1);
  });
