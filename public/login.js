const API='/api/v1';
const SESSION_KEY='gcims_pos_session';
const form=document.querySelector('#login-form');
const errorBox=document.querySelector('#login-error');

function readSession(){try{return JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');}catch{return null;}}
function setError(message){errorBox.textContent=message;errorBox.classList.toggle('hidden',!message);}
async function identify(token){
  const response=await fetch(`${API}/auth/me`,{headers:{authorization:`Bearer ${token}`}});
  if(!response.ok)throw new Error('Sesi tidak berlaku. Silakan masuk kembali.');
  return response.json();
}
function goToRole(permissions){location.replace((permissions??[]).includes('admin.dashboard.read')?'/admin':'/pos');}

const existing=readSession();
if(existing?.token){
  identify(existing.token).then((identity)=>goToRole(identity.permissions)).catch(()=>sessionStorage.removeItem(SESSION_KEY));
}

form.addEventListener('submit',async(event)=>{
  event.preventDefault();
  const button=form.querySelector('button[type="submit"]');
  const values=new FormData(form);
  button.disabled=true;
  button.innerHTML='<span>Memeriksa akun…</span><span>···</span>';
  setError('');
  try{
    const response=await fetch(`${API}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:String(values.get('username')).trim(),password:String(values.get('password'))})});
    const result=await response.json();
    if(!response.ok)throw new Error(result?.error?.message??'Username atau password tidak valid.');
    const session={token:result.access_token,user:result.user,scope:result.scope};
    sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));
    const identity=await identify(session.token);
    goToRole(identity.permissions);
  }catch(error){setError(error.message||'Tidak dapat masuk. Coba lagi.');}
  finally{button.disabled=false;button.innerHTML='<span>Masuk</span><span aria-hidden="true">→</span>';}
});
