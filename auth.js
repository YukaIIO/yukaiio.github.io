/* School-only authentication. Offline accounts remain local to this browser. */
(()=>{
  const $=s=>document.querySelector(s);
  let mode='register',audience=localStorage.getItem('plannerAudience')==='external'?'external':'school',externalLogoData='';
  const classCodes=['1/1','1/2','2/1','2/2','2/3','2/4','3/1','3/2','3/3','4/1','4/2','4/3','5/1','5/2','6/1','6/2'];
  const cfg=window.SUPABASE_CONFIG||{};
  const configured=Boolean(cfg.url&&cfg.anonKey&&!cfg.url.includes('YOUR_')&&!cfg.anonKey.includes('YOUR_'));
  const client=configured&&window.supabase?.createClient?window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
  window.plannerSupabase=client;window.plannerCloudMode=configured;
  const digest=async(password,salt)=>{
    if(!crypto?.subtle)throw new Error('โปรดเปิดผ่าน localhost หรือ HTTPS');
    const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,256);
    return [...new Uint8Array(bits)].map(x=>x.toString(16).padStart(2,'0')).join('');
  };
  const hex=b=>[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
  const error=(m,success=false)=>{const n=$('#authError');n.textContent=m;n.hidden=!m;n.classList.toggle('auth-success',Boolean(m)&&success)};
  const profileFromRow=(row,user)=>({name:row?.full_name||user?.user_metadata?.full_name||'',id:row?.student_number||user?.user_metadata?.student_number||'',classCode:row?.class_code||user?.user_metadata?.class_code||(row?.account_type==='external'?'ทั่วไป':'4/2'),rollNumber:row?.roll_number??user?.user_metadata?.roll_number??'',avatar:row?.avatar_data||'',accountType:row?.account_type||user?.user_metadata?.account_type||'school',academicYear:Number(row?.academic_year||user?.user_metadata?.academic_year||2569),brandLogo:row?.brand_logo_url||user?.user_metadata?.brand_logo||''});
  const openLocalDB=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('StudentPlannerDB',5);r.onupgradeneeded=()=>{const d=r.result;for(const [name,opts] of [['tasks',{keyPath:'id',autoIncrement:true}],['profile',{keyPath:'key'}],['loginHistory',{keyPath:'id',autoIncrement:true}],['accounts',{keyPath:'id'}],['schedules',{keyPath:'key'}],['syncQueue',{keyPath:'key'}]])if(!d.objectStoreNames.contains(name))d.createObjectStore(name,opts)};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  const idbRequest=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  async function cacheCloudAccount(user,profile,password){const db=await openLocalDB(),existing=await idbRequest(db.transaction('accounts').objectStore('accounts').get(profile.id));let account={...existing,id:profile.id,cloudId:user.id,email:user.email,name:profile.name,classCode:profile.classCode,rollNumber:profile.rollNumber||'',accountType:profile.accountType,academicYear:profile.academicYear,brandLogo:profile.brandLogo};if(password){const salt=crypto.getRandomValues(new Uint8Array(16));account.salt=hex(salt);account.hash=await digest(password,salt)}await idbRequest(db.transaction('accounts','readwrite').objectStore('accounts').put(account));await idbRequest(db.transaction('profile','readwrite').objectStore('profile').put({key:`cloud:${user.id}`,value:profile}))}
  async function offlineCloudLogin(studentNumber,password,classCode){const db=await openLocalDB(),accounts=await idbRequest(db.transaction('accounts').objectStore('accounts').getAll()),account=accounts.find(a=>audience==='external'?a.email?.toLowerCase()===studentNumber.toLowerCase():a.id===studentNumber);if(!account?.cloudId||!account.hash||!account.salt)throw new Error('บัญชีนี้ยังไม่เคยเข้าสู่ระบบออนไลน์บนอุปกรณ์นี้ จึงยังไม่มีข้อมูลสำหรับใช้ออฟไลน์');const salt=new Uint8Array(account.salt.match(/.{2}/g).map(x=>parseInt(x,16)));if(await digest(password,salt)!==account.hash)throw new Error('รหัสนักเรียนหรือรหัสผ่านไม่ถูกต้อง');const profile=(await idbRequest(db.transaction('profile').objectStore('profile').get(`cloud:${account.cloudId}`)))?.value;if(!profile)throw new Error('ไม่พบโปรไฟล์ที่บันทึกไว้ในเครื่อง กรุณาเชื่อมต่ออินเทอร์เน็ตก่อน');window.plannerUser={id:account.cloudId,email:account.email,offline:true};window.plannerProfile=profile;window.dispatchEvent(new CustomEvent('planner:authenticated',{detail:{user:window.plannerUser,profile}}))}
  async function getProfile(user){try{const {data,error:e}=await client.from('profiles').select('full_name,student_number,class_code,roll_number,avatar_data,account_type,academic_year,brand_logo_url').eq('id',user.id).single();if(e)throw e;return profileFromRow(data,user)}catch(e){const db=await openLocalDB(),cached=await idbRequest(db.transaction('profile').objectStore('profile').get(`cloud:${user.id}`));if(cached?.value)return cached.value;throw e}}
  async function publishExternalLogo(user,dataUrl){const blob=await fetch(dataUrl).then(r=>r.blob()),ext=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg',path=`${user.id}/brand-logo.${ext}`,bucket=client.storage.from('user-brand-logos'),{error:uploadError}=await bucket.upload(path,blob,{upsert:true,contentType:blob.type,cacheControl:'3600'});if(uploadError)throw uploadError;const {data}=bucket.getPublicUrl(path),url=data.publicUrl;const {error:profileError}=await client.from('profiles').update({brand_logo_url:url}).eq('id',user.id);if(profileError)throw profileError;return url}
  async function setCloudUser(user,password){window.plannerUser=user;const profile=await getProfile(user);if(profile.accountType==='external'){const key=`plannerPendingBrandLogo:${user.email}`,pending=externalLogoData||localStorage.getItem(key);if(pending){profile.brandLogo=await publishExternalLogo(user,pending);externalLogoData='';localStorage.removeItem(key)}}window.plannerProfile=profile;await cacheCloudAccount(user,window.plannerProfile,password);window.dispatchEvent(new CustomEvent('planner:authenticated',{detail:{user,profile:window.plannerProfile}}))}
  const getClassCode=()=>audience==='external'?$('#loginExternalClass').value.trim():$('#loginClass').value;
  const setAccountFieldLabel=()=>{$('#authStudentIdLabel').firstChild.textContent=audience==='external'?'อีเมลที่ใช้สมัคร':mode==='login'&&configured?'รหัสนักเรียน / อีเมลบัญชี':'รหัสนักเรียน (5 หลัก)';$('#loginStudentId').placeholder=audience==='external'?'name@example.com':mode==='login'&&configured?'รหัสนักเรียน หรืออีเมลที่ใช้สมัคร':'เช่น 12345';$('#loginStudentId').type=audience==='external'?'email':'text'};
  const update=()=>{
    const reg=mode==='register',login=mode==='login',forgot=mode==='forgot',reset=mode==='reset';
    // Keep the name field visible on login as requested; it is optional there
    // because the account is authenticated by its registered ID/email + password.
    $('#authNameLabel').hidden=!(reg||login);$('#loginName').required=reg;
    $('#authStudentIdLabel').hidden=audience==='external'?!(login):!(reg||login);$('#loginStudentId').required=audience==='school'&&(reg||login)||audience==='external'&&login;
    $('#authClassLabel').hidden=audience==='external'?!reg:!(reg||login);$('#loginClass').hidden=audience==='external';$('#loginExternalClass').hidden=audience!=='external';$('#loginClass').required=audience==='school'&&(reg||login);$('#loginExternalClass').required=audience==='external'&&reg;
    $('#authRollNumberLabel').hidden=!reg||audience==='external';$('#loginRollNumber').required=false;
    $('#authEmailLabel').hidden=!(reg||forgot);$('#loginEmail').required=reg||forgot;
    $('#externalOptions').hidden=audience!=='external'||!reg;$('#schoolOnlyNote').hidden=audience!=='school';document.body.classList.toggle('external-audience',audience==='external');if(!reg)$('#loginAcademicYear').value='2569';$('#audienceSwitch').textContent=audience==='school'?'สำหรับคนภายนอก':'สำหรับนักเรียนโรงเรียนพยุห์วิทยา';$('#audienceSwitch').setAttribute('aria-pressed',String(audience==='external'));$('#audienceStatus').textContent=audience==='school'?'นักเรียนโรงเรียนพยุห์วิทยา':'บัญชีส่วนตัว';
    $('#loginLogoWrap').hidden=audience==='external'&&!externalLogoData;if(externalLogoData){$('#loginLogo').src=externalLogoData;$('#loginLogo').alt='โลโก้ของคุณ'}else{$('#loginLogo').src='school-logo.png';$('#loginLogo').alt='ตราโรงเรียนพยุห์วิทยา'}const splash=$('#pageLoader img');if(splash){splash.hidden=audience==='external'&&!externalLogoData;if(externalLogoData)splash.src=externalLogoData;else splash.src='school-logo.png'}
    $('#authPasswordLabel').hidden=!(reg||login||reset);$('#loginPassword').required=reg||login||reset;$('#loginPassword').autocomplete=reg||reset?'new-password':'current-password';$('#loginPassword').minLength=reg||reset?8:1;
    $('#authConfirmPasswordLabel').hidden=!reset;$('#loginPasswordConfirm').required=reset;
    $('#forgotPasswordBtn').hidden=!login;
    $('#authModeLabel').textContent=reg?'REGISTER':login?'LOG IN':forgot?'RECOVER':'RESET PASSWORD';
    $('#authHeading').textContent=reg?'ลงทะเบียนสมุดบันทึกงาน':login?'เข้าสู่ระบบสมุดบันทึกงาน':forgot?'ลืมรหัสผ่าน':'ตั้งรหัสผ่านใหม่';
    $('#authSubmit').innerHTML=(reg?'ลงทะเบียน':login?'เข้าสู่ระบบ':forgot?'ส่งลิงก์เปลี่ยนรหัสผ่าน':'บันทึกรหัสผ่านใหม่')+' <span>→</span>';
    $('#authSwitch').hidden=reset;$('#authSwitch').textContent=reg?'มีบัญชีแล้ว? เข้าสู่ระบบ':login?'ยังไม่มีบัญชี? ลงทะเบียน':'กลับไปเข้าสู่ระบบ';
    $('#authDescription').textContent=reg?(audience==='external'?'สร้างบัญชีส่วนตัว ตั้งระดับชั้นและปีการศึกษาได้เอง พร้อมกำหนดตารางเรียนภายหลัง':'สร้างบัญชีสำหรับนักเรียนโรงเรียนพยุห์วิทยา ด้วยชื่อจริง รหัสนักเรียน ชั้น/ห้อง และอีเมล'):login?(audience==='external'?'กรอกอีเมลและรหัสผ่านของบัญชีส่วนตัว':configured?'กรอกชื่อ (ไม่บังคับ) และรหัสนักเรียนหรืออีเมลที่ใช้สมัคร พร้อมรหัสผ่าน':'กรอกชื่อ (ไม่บังคับ) รหัสนักเรียน และรหัสผ่านที่สมัครไว้ · บัญชีออฟไลน์เก็บในเบราว์เซอร์นี้'):
      forgot?'กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้':reset?'ตั้งรหัสผ่านใหม่หลังเปิดลิงก์ที่ส่งไปยังอีเมลของคุณ':'';
    $('#loginName').autocomplete=reg||login?'name':'off';setAccountFieldLabel();
    error(configured&&!client&&navigator.onLine?'โหลด Supabase SDK ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วโหลดหน้าใหม่':'');
  };
  window.plannerVerifyStudentPassword=async password=>{
    if(window.plannerCloudMode&&client&&navigator.onLine){const email=window.plannerUser?.email;if(!email)throw new Error('ไม่พบอีเมลบัญชีสำหรับยืนยันตัวตน');const {data,error:e}=await client.auth.signInWithPassword({email,password});if(e)throw new Error('รหัสผ่านไม่ถูกต้อง');await setCloudUser(data.user,password);return true}
    const id=window.plannerProfile?.id||window.plannerUser?.id;if(!id)throw new Error('ไม่พบบัญชีนักเรียนในเครื่องนี้');
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('StudentPlannerDB',5);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    const account=await new Promise((resolve,reject)=>{const r=db.transaction('accounts','readonly').objectStore('accounts').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    if(!account)throw new Error('ไม่พบบัญชีในเครื่องนี้');const salt=new Uint8Array(account.salt.match(/.{2}/g).map(x=>parseInt(x,16)));if(await digest(password,salt)!==account.hash)throw new Error('รหัสผ่านไม่ถูกต้อง');return true;
  };
  window.plannerChangeLocalStudentId=async(oldId,newId,profile)=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('StudentPlannerDB',5);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    const account=await new Promise((resolve,reject)=>{const r=db.transaction('accounts','readonly').objectStore('accounts').get(oldId);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    if(!account)throw new Error('ไม่พบบัญชีออฟไลน์เดิม');account.id=newId;if(profile){account.name=profile.name;account.classCode=profile.classCode;account.rollNumber=profile.rollNumber||''}
    await new Promise((resolve,reject)=>{const t=db.transaction('accounts','readwrite');t.objectStore('accounts').put(account);if(oldId!==newId)t.objectStore('accounts').delete(oldId);t.oncomplete=resolve;t.onerror=()=>reject(t.error)});
  };
  $('#authSwitch').addEventListener('click',()=>{mode=mode==='register'?'login':mode==='login'?'register':'login';update()});
  $('#audienceSwitch').addEventListener('click',()=>{audience=audience==='school'?'external':'school';localStorage.setItem('plannerAudience',audience);externalLogoData='';$('#externalLogoInput').value='';$('#externalLogoPreview').hidden=true;$('#loginStudentId').value='';mode='register';update()});
  $('#externalLogoInput').addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>1024*1024){error('โลโก้ต้องเป็น PNG, JPG หรือ WebP และมีขนาดไม่เกิน 1 MB');e.target.value='';return}const reader=new FileReader();reader.onload=()=>{externalLogoData=String(reader.result||'');$('#externalLogoPreview').innerHTML=`<img src="${externalLogoData}" alt="ตัวอย่างโลโก้" />`;$('#externalLogoPreview').hidden=false;update()};reader.onerror=()=>error('อ่านไฟล์โลโก้ไม่สำเร็จ');reader.readAsDataURL(file)});
  $('#forgotPasswordBtn').addEventListener('click',()=>{mode='forgot';update()});
  $('#loginForm').addEventListener('submit',async e=>{
    if(e.target.dataset.authenticated==='true'){delete e.target.dataset.authenticated;return}
    e.preventDefault();error('');const button=$('#authSubmit');button.disabled=true;
    try{
      if(configured&&!client&&navigator.onLine)throw new Error('Supabase SDK โหลดไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วโหลดหน้าใหม่');
      if(mode==='forgot'){
        if(!client)throw new Error('การส่งลิงก์กู้รหัสผ่านต้องเปิดใช้ Supabase และเว็บไซต์ผ่าน HTTPS หรือ localhost');
        const email=$('#loginEmail').value.trim();if(!email)throw new Error('กรุณากรอกอีเมลที่ใช้สมัคร');
        const redirectTo=new URL('./index.html',window.location.href).href;
        const {error:e}=await client.auth.resetPasswordForEmail(email,{redirectTo});if(e)throw e;
        error('ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว โปรดตรวจกล่องจดหมายและโฟลเดอร์จดหมายขยะ',true);return;
      }
      if(mode==='reset'){
        const password=$('#loginPassword').value,confirmPassword=$('#loginPasswordConfirm').value;
        if(password.length<8)throw new Error('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');if(password!==confirmPassword)throw new Error('รหัสผ่านทั้งสองช่องไม่ตรงกัน');if(!client)throw new Error('ต้องเชื่อม Supabase เพื่อบันทึกรหัสผ่านใหม่');
        const {data,error:e}=await client.auth.updateUser({password});if(e)throw e;mode='login';update();await setCloudUser(data.user,password);error('เปลี่ยนรหัสผ่านสำเร็จแล้ว',true);return;
      }
      let id=$('#loginStudentId').value.trim();const classCode=getClassCode(),password=$('#loginPassword').value,rollNumber=$('#loginRollNumber').value,academicYear=Number($('#loginAcademicYear').value||2569);
      if(audience==='school'&&!classCodes.includes(classCode))throw new Error('กรุณาเลือกชั้น/ห้องจากรายการ');
      if(audience==='external'&&mode==='register'&&(!classCode||classCode.length>40))throw new Error('กรุณากรอกระดับชั้น 1–40 ตัวอักษร');
      if(audience==='external'&&mode==='register'&&(!Number.isInteger(academicYear)||academicYear<2500||academicYear>2700))throw new Error('ปีการศึกษาต้องอยู่ระหว่าง 2500–2700');
      if(audience==='external'&&mode==='register')id=`EXT-${crypto.randomUUID()}`;
      if((client||configured)&&mode==='login'&&!navigator.onLine){await offlineCloudLogin(id,password,classCode)}else if(client){
        let result;
        if(mode==='register'){
          if(audience==='school'&&!/^[0-9]{5}$/.test(id))throw new Error('กรุณากรอกรหัสนักเรียนเป็นตัวเลข 5 หลัก');
          const name=$('#loginName').value.trim();if(name.length<2||name.length>100)throw new Error('กรุณากรอกชื่อจริง 2–100 ตัวอักษร');
          const email=$('#loginEmail').value.trim();if(password.length<8)throw new Error('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
          if(audience==='school'&&rollNumber&&(+rollNumber<1||+rollNumber>60))throw new Error('เลขที่ต้องอยู่ระหว่าง 1–60');
          if(audience==='external'&&externalLogoData)localStorage.setItem(`plannerPendingBrandLogo:${email}`,externalLogoData);
          result=await client.auth.signUp({email,password,options:{data:{full_name:name,student_number:id,class_code:classCode,roll_number:audience==='school'?(rollNumber||null):null,account_type:audience,academic_year:audience==='external'?academicYear:2569}}});
          if(result.error)throw result.error;try{localStorage.setItem(`plannerAuthAlias:${id}`,JSON.stringify({email,classCode}))}catch{}
          if(!result.data.session){mode='login';update();error('สมัครบัญชีแล้ว โปรดยืนยันจากอีเมล แล้วเข้าสู่ระบบด้วยอีเมลที่สมัคร');return}
          await setCloudUser(result.data.user,password);
        }else{
          let email=id;if(audience==='external'&&!id.includes('@'))throw new Error('กรุณาเข้าสู่ระบบด้วยอีเมลที่ใช้สมัคร');if(!id.includes('@')){try{email=JSON.parse(localStorage.getItem(`plannerAuthAlias:${id}`)||'null')?.email||''}catch{email=''}if(!email)throw new Error('บนอุปกรณ์นี้ไม่พบอีเมลที่ผูกกับรหัสนักเรียน ให้กรอกอีเมลที่ใช้สมัครแทน')}
          result=await client.auth.signInWithPassword({email,password});if(result.error)throw result.error;try{localStorage.setItem(`plannerAuthAlias:${result.data.user.user_metadata.student_number||id}`,JSON.stringify({email,classCode}))}catch{}await setCloudUser(result.data.user,password);
        }
        $('#loginName').value=window.plannerProfile.name;$('#loginStudentId').value=window.plannerProfile.id;$('#loginClass').value=window.plannerProfile.classCode||classCode;$('#loginExternalClass').value=window.plannerProfile.classCode||classCode;$('#loginAcademicYear').value=window.plannerProfile.academicYear||academicYear;externalLogoData=window.plannerProfile.brandLogo||externalLogoData;
      }else{
        if(audience==='school'&&!/^[0-9]{5}$/.test(id))throw new Error('กรุณากรอกรหัสนักเรียนเป็นตัวเลข 5 หลัก');
        const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('StudentPlannerDB',5);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('accounts'))r.result.createObjectStore('accounts',{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
        const accounts=await new Promise((resolve,reject)=>{const t=db.transaction('accounts','readonly'),r=t.objectStore('accounts').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});let account=accounts.find(x=>audience==='external'?x.email?.toLowerCase()===($('#loginEmail').value.trim()||id).toLowerCase():x.id===id);
        if(mode==='register'){
          if(account)throw new Error('บัญชีนี้สมัครไว้แล้ว กรุณาเข้าสู่ระบบ');if(accounts.length)throw new Error('เบราว์เซอร์นี้มีบัญชีอยู่แล้ว เพื่อป้องกันการปะปนของข้อมูลงาน บัญชีออฟไลน์รองรับหนึ่งบัญชีต่อเบราว์เซอร์');
          const name=$('#loginName').value.trim(),email=$('#loginEmail').value.trim();if(name.length<2||name.length>100)throw new Error('กรุณากรอกชื่อจริง 2–100 ตัวอักษร');if(password.length<8)throw new Error('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');if(audience==='school'&&rollNumber&&(+rollNumber<1||+rollNumber>60))throw new Error('เลขที่ต้องอยู่ระหว่าง 1–60');
          const salt=crypto.getRandomValues(new Uint8Array(16)),hash=await digest(password,salt);
          await new Promise((resolve,reject)=>{const t=db.transaction('accounts','readwrite'),r=t.objectStore('accounts').add({id,name,classCode,rollNumber:audience==='school'?(rollNumber||''):'',email,salt:hex(salt),hash,accountType:audience,academicYear:audience==='external'?academicYear:2569,brandLogo:audience==='external'?externalLogoData:'',createdAt:new Date().toISOString()});r.onsuccess=resolve;r.onerror=()=>reject(r.error)});account={id,name,classCode,rollNumber:audience==='school'?(rollNumber||''):'',email,accountType:audience,academicYear:audience==='external'?academicYear:2569,brandLogo:audience==='external'?externalLogoData:''};
        }else{
          if(!account)throw new Error('ไม่พบบัญชีนี้ในเครื่อง กรุณาสมัครบัญชีก่อน');const salt=new Uint8Array(account.salt.match(/.{2}/g).map(x=>parseInt(x,16)));if(await digest(password,salt)!==account.hash)throw new Error('รหัสนักเรียนหรือรหัสผ่านไม่ถูกต้อง');$('#loginName').value=account.name;id=account.id;
          await new Promise((resolve,reject)=>{const t=db.transaction('accounts','readwrite'),r=t.objectStore('accounts').put(account);r.onsuccess=resolve;r.onerror=()=>reject(r.error)});
        }
        $('#loginName').value=account?.name||$('#loginName').value;
      }
      if(!client&&!configured){const account=await new Promise((resolve,reject)=>{const r=indexedDB.open('StudentPlannerDB',5);r.onsuccess=()=>{const q=r.result.transaction('accounts','readonly').objectStore('accounts').get(id);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)};r.onerror=()=>reject(r.error)});window.plannerUser={id};window.plannerProfile={name:account?.name||$('#loginName').value.trim(),id,classCode:account?.classCode||classCode,rollNumber:account?.rollNumber||'',avatar:localStorage.getItem(`plannerAvatar:${id}`)||'',accountType:account?.accountType||audience,academicYear:account?.academicYear||2569,brandLogo:account?.brandLogo||''};window.dispatchEvent(new CustomEvent('planner:authenticated',{detail:{user:window.plannerUser,profile:window.plannerProfile}}))}
      localStorage.removeItem('plannerLogin');e.target.dataset.authenticated='true';e.target.requestSubmit();
    }catch(ex){error(ex.message||'ไม่สามารถดำเนินการได้ กรุณาลองใหม่')}finally{button.disabled=false}
  },true);
  update();
  if(client){
    client.auth.onAuthStateChange((event,session)=>{if(event==='PASSWORD_RECOVERY'){mode='reset';update();error('กรุณาตั้งรหัสผ่านใหม่')}else if(event==='SIGNED_OUT'){mode='login';update()}});
    client.auth.getSession().then(async({data,error:e})=>{if(e){error(e.message);return}if(data.session&&mode!=='reset')try{await setCloudUser(data.session.user)}catch(ex){error('อ่านข้อมูลบัญชีไม่สำเร็จ: '+ex.message)}});
    window.addEventListener('online',async()=>{const {data}=await client.auth.getSession();if(data.session)try{await setCloudUser(data.session.user)}catch{} });
  }
})();
