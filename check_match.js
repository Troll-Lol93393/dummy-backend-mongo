const mongoose = require('mongoose');
require('dotenv').config();
const { DB_NAME } = require('./dist/constants');

async function check() {
  await mongoose.connect(process.env.MONGODB_URI + '/' + DB_NAME);

  const rfq = await mongoose.connection.db.collection('rfqs').findOne({ isDeleted: false });
  if (!rfq) { console.log('No RFQ found'); process.exit(); }

  const rfqItemIds = rfq.items || [];
  const rfqItems = await mongoose.connection.db.collection('rfqitems').find({ _id: { $in: rfqItemIds } }).toArray();

  const itemIds = rfqItems.map(ri => ri.item);
  const items = await mongoose.connection.db.collection('items').find({ _id: { $in: itemIds } }).toArray();
  const itemCodes = items.map(i => i.itemCode);

  console.log('RFQ PR:', rfq.prNumber);
  console.log('Item codes in RFQ:', itemCodes);

  // Check PO Register for matching item codes
  const pos = await mongoose.connection.db.collection('poregisters').find({
    'items.itemCode': { $in: itemCodes },
    isDeleted: false
  }).project({ poNumber: 1, 'items.itemCode': 1 }).limit(5).toArray();

  console.log('Matching POs found:', pos.length);
  if (pos.length > 0) {
    pos.forEach(po => {
      const matched = po.items.filter(i => itemCodes.includes(i.itemCode)).map(i => i.itemCode);
      console.log('  PO:', po.poNumber, '-> matched codes:', matched);
    });
  }

  // Show samples for comparison
  const samplePO = await mongoose.connection.db.collection('poregisters').findOne({ isDeleted: false });
  if (samplePO) {
    console.log('\nSample PO item codes:', samplePO.items.slice(0, 3).map(i => i.itemCode));
  }
  console.log('Sample RFQ item codes:', itemCodes.slice(0, 3));

  // Also check SET/ASSEMBLY items with BOM
  const setItems = items.filter(i => i.itemType === 'SET' || i.itemType === 'ASSEMBLY');
  console.log('\nSET/ASSEMBLY items:', setItems.length);
  setItems.forEach(i => {
    console.log('  ', i.itemCode, i.itemType, 'BOM parts:', (i.bom || []).length);
    if (i.bom && i.bom.length > 0) {
      i.bom.forEach(b => console.log('    -', b.quantity, b.partName));
    }
  });

  await mongoose.disconnect();
}
check().catch(e => { console.error(e.message); process.exit(1); });
