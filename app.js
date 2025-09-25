
const BACKEND = "https://cripetingamali.onrender.com/api";
let token = null;

function showView(viewId) {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('admin-view').style.display = 'none';
  document.getElementById('user-view').style.display = 'none';
  document.getElementById(viewId).style.display = 'block';
}

function login() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  fetch(`${BACKEND}/login`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({username,password})
  })
  .then(res=>res.json())
  .then(data=>{
    if(data.success){
      token = data.token;
      localStorage.setItem('token', token);
      if(data.username==='admin') showView('admin-view');
      else showView('user-view');
    } else {
      document.getElementById('login-msg').innerText = data.message;
    }
  });
}

function register() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  fetch(`${BACKEND}/register`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({username,password})
  })
  .then(res=>res.json())
  .then(data=>{
    document.getElementById('login-msg').innerText = data.message;
  });
}

function logout(){
  token=null;
  localStorage.removeItem('token');
  showView('login-view');
}

function requestWithdrawal(){
  alert('Withdrawal request submitted (needs admin approval)');
}
