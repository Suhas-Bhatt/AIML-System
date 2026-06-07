const url = "https://qikmqjxmclriyuwwayup.supabase.co/rest/v1/interviews?select=id&limit=1";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpa21xanhtY2xyaXl1d3dheXVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MDU5NjMsImV4cCI6MjA5MzM4MTk2M30.xHhEYSRTgG7ujVME1_A3JtVv_B4ryeCFlQK09-cfEi0";

fetch(url, {
  headers: {
    "apikey": key,
    "Authorization": `Bearer ${key}`
  }
})
.then(res => res.json().then(data => ({status: res.status, data})))
.then(console.log)
.catch(console.error);
