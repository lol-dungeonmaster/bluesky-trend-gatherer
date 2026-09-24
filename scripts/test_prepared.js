const fs = require('fs');
const duckdb = require('duckdb');

const db = new duckdb.Database(':memory:');
db.all("CREATE TABLE test (a TEXT, b TEXT)");
const stmt = db.prepare("INSERT INTO test (a, b) VALUES (?, ?)");
stmt.run("hello", "world's", (err) => {
    if (err) console.error(err);
    db.all("SELECT * FROM test", (err, res) => {
        console.log(res);
    });
});
