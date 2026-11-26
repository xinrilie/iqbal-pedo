const API='/api/v1';
try { sessionStorage.removeItem('gcims_pos_session'); } catch {}
const form=document.querySelector('#login-form');
const errorBox=document.querySelector('#login-error');

function setError(message){errorBox.textContent=message;errorBox.classList.toggle('hidden',!message);}
async function identify(){
  const response=await fetch(`${API}/auth/me`);
  if(!response.ok)throw new Error('Sesi tidak berlaku. Silakan masuk kembali.');
  return response.json();
}
function goToRole(permissions){location.replace((permissions??[]).includes('admin.dashboard.read')?'/admin':'/pos');}

identify().then((identity)=>goToRole(identity.permissions)).catch(()=>{});

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
    const identity=await identify();
    goToRole(identity.permissions);
  }catch(error){
    setError(error instanceof TypeError
      ? 'Tidak dapat terhubung ke server. Pastikan backend aktif, lalu coba lagi.'
      : error.message||'Tidak dapat masuk. Coba lagi.');
  }
  finally{button.disabled=false;button.innerHTML='<span>Masuk</span><span aria-hidden="true">→</span>';}
});
