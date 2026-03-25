const mongoose = require('mongoose');
require('dotenv').config();
const { DB_NAME } = require('./dist/constants');

async function check() {
  await mongoose.connect(process.env.MONGODB_URI + '/' + DB_NAME);

  const itemCode = '2100994828';

  // Check PO history for this item
  const pos = await mongoose.connection.db.collection('poregisters').find({
    'items.itemCode': itemCode,
    isDeleted: false
  }).project({ poNumber: 1, poDate: 1, 'items.itemCode': 1 }).sort({ poDate: -1 }).toArray();

  console.log('=== PO HISTORY for', itemCode, '===');
  console.log('POs found:', pos.length);
  pos.forEach(po => {
    const hasItem = po.items.some(i => i.itemCode === itemCode);
    console.log('  PO:', po.poNumber, '| Date:', po.poDate, '| Has item:', hasItem);
  });

  // Check item master
  const item = await mongoose.connection.db.collection('items').findOne({ itemCode });
  console.log('\n=== ITEM MASTER ===');
  console.log('Type:', item?.itemType);
  console.log('BOM parts:', (item?.bom || []).length);
  if (item?.bom) {
    item.bom.forEach(b => console.log('  -', b.quantity, b.partName));
  }

  // Check latest snapshot
  const offer = await mongoose.connection.db.collection('technicaloffers')
    .findOne({}, { sort: { createdAt: -1 } });
  const snapshotItem = offer?.snapshot?.items?.find(i => i.itemCode === itemCode);
  console.log('\n=== LATEST SNAPSHOT REMARKS ===');
  console.log('Version:', offer?.version);
  console.log('Remarks:', JSON.stringify(snapshotItem?.remarks));

  await mongoose.disconnect();
}
check().catch(e => { console.error(e.message); process.exit(1); });
