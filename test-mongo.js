const mongoose = require('mongoose');
mongoose.connect(
  'mongodb://4chawlaclasses_db_user:RohitClassesChawla2026DB@ac-3jjq8ls-shard-00-00.g0hqgeb.mongodb.net:27017,ac-3jjq8ls-shard-00-01.g0hqgeb.mongodb.net:27017,ac-3jjq8ls-shard-00-02.g0hqgeb.mongodb.net:27017/chawla_classes?ssl=true&authSource=admin&retryWrites=true&w=majority&appName=Cluster0'
)
.then(() => {
  console.log('✅ Connected');
  process.exit(0);
})
.catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
