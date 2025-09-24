// Replace with your Render backend URL
const BACKEND = 'https://cripetingamali.onrender.com';

document.getElementById('load').addEventListener('click', async () => {
    const output = document.getElementById('output');
    output.textContent = 'Loading...';
    try {
        const res = await fetch(BACKEND + '/api/hello');
        if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
        const data = await res.json();
        output.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
        output.textContent = 'Error: ' + err;
    }
});