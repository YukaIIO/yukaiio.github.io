/*
 * การเชื่อมต่อ Supabase
 * 1) สร้างโปรเจกต์ใน https://supabase.com
 * 2) ไปที่ Project Settings > API
 * 3) นำ Project URL และ Publishable/anon key มาใส่ด้านล่าง
 * ห้ามนำ service_role key มาใส่ในไฟล์หน้าเว็บเด็ดขาด
 */
window.SUPABASE_CONFIG = {
  url: 'YOUR_SUPABASE_URL',
  anonKey: 'YOUR_SUPABASE_PUBLISHABLE_KEY'
};
