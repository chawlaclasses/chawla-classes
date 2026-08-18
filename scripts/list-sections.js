require("dotenv").config();
const db = require("../services/jsonDb");

db.connect().then(() => {
  const all = db.find("websiteSections", {});
  console.log(`Total: ${all.length} sections\n`);
  all.forEach((s) => {
    console.log(`- id: ${s._id}`);
    console.log(`  type: ${s.type}`);
    console.log(`  page: ${JSON.stringify(s.page)}`);
    console.log(`  isActive: ${s.isActive}`);
    console.log('');
  });
}).catch(err => console.error(err.message)).finally(() => db.close());