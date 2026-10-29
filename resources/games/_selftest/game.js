// Self-test game for Quot3's host tests: writes its own localStorage and nothing else.
document.getElementById('msg').textContent = 'selftest ok'
try { localStorage.setItem('q3-selftest', '1') } catch (e) { /* storage may be unavailable */ }
