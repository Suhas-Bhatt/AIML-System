const http = require('http');

http.get('http://localhost:3000/api/trpc/health', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    console.log('HEADERS:', res.headers);
    console.log('BODY:', data.substring(0, 1000)); // Log first 1000 chars of body
  });
}).on('error', (err) => {
  console.log('Error fetching:', err.message);
});
