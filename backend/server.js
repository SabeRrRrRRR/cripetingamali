
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const db = new sqlite3.Database('./data.sqlite');

db.serialize(()=>{
  db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, balance REAL, address TEXT, frozen INTEGER)');
  db.run('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, min_withdraw REAL)');
  db.run('CREATE TABLE IF NOT EXISTS withdrawals (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL, status TEXT)');
  db.get('SELECT * FROM users WHERE username="admin"', (err,row)=>{
    if(!row){
      db.run('INSERT INTO users (username,password,balance,address,frozen) VALUES (?,?,?,?,?)',
        ["admin","123456",1000,"ADMINADDR",0]);
      db.run('INSERT INTO users (username,password,balance,address,frozen) VALUES (?,?,?,?,?)',
        ["user1","pass1",100,"ADDR1",0]);
      db.run('INSERT INTO users (username,password,balance,address,frozen) VALUES (?,?,?,?,?)',
        ["user2","pass2",200,"ADDR2",0]);
    }
  });
  db.get('SELECT * FROM settings WHERE id=1', (err,row)=>{
    if(!row) db.run('INSERT INTO settings (min_withdraw) VALUES (?)',[40]);
  });
});

app.get('/', (req,res)=>res.send('Backend running. Use /api endpoints.'));

app.post('/api/login',(req,res)=>{
  const {username,password}=req.body;
  db.get('SELECT * FROM users WHERE username=? AND password=?',[username,password],(err,row)=>{
    if(row) res.json({success:true,username:row.username,token:"FAKETOKEN"});
    else res.json({success:false,message:"Invalid credentials"});
  });
});

app.post('/api/register',(req,res)=>{
  const {username,password}=req.body;
  db.run('INSERT INTO users (username,password,balance,address,frozen) VALUES (?,?,?,?,?)',
    [username,password,100,"ADDR"+Date.now(),0],function(err){
      if(err) res.json({success:false,message:"Username exists"});
      else res.json({success:true,message:"Registered successfully"});
    });
});

app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
