const mongoose = require('mongoose');
require('dotenv').config();
const { DB_NAME } = require('./dist/constants');

async function check() {
  await mongoose.connect(process.env.MONGODB_URI + '/' + DB_NAME);

  // Get the latest technical offer
  const offer = await mongoose.connection.db.collection('technicaloffers')
    .findOne({}, { sort: { createdAt: -1 } });

  if (!offer) { console.log('No offers found'); process.exit(); }

  console.log('Offer version:', offer.version, 'Status:', offer.status);
  console.log('Created:', offer.createdAt);
  console.log('Items count:', offer.snapshot.items.length);
  console.log('\n--- REMARKS FOR EACH ITEM ---');
  offer.snapshot.items.forEach((item, i) => {
    console.log(`\n[${i}] ${item.itemCode} (${item.itemType}) - remarks:`);
    console.log(item.remarks ? `"${item.remarks}"` : '(empty)');
  });

  await mongoose.disconnect();
}
check().catch(e => { console.error(e.message); process.exit(1); });
