(() => {
  const $ = id => document.getElementById(id);

  // When a tool is selected from the homepage menu, show only that tool.
  // Opening tools.html without a valid tool hash keeps the full dashboard.
  const toolPanels = [...document.querySelectorAll('.tool-panel')];
  const selectedTool = decodeURIComponent(location.hash.slice(1));
  const validTool = toolPanels.find(panel => panel.id === selectedTool);
  if (validTool) {
    toolPanels.forEach(panel => {
      panel.hidden = panel !== validTool;
      panel.style.display = panel === validTool ? '' : 'none';
    });
    const introTitle = document.querySelector('.tools-intro h1');
    const introText = document.querySelector('.tools-intro p');
    if (introTitle) introTitle.textContent = validTool.querySelector('h2')?.textContent || 'Selected Tool';
    if (introText) introText.textContent = 'Use this tool below. Open the full dashboard to choose another tool.';
    const allToolsLink = document.createElement('a');
    allToolsLink.className = 'tools-link';
    allToolsLink.href = 'tools.html';
    allToolsLink.textContent = '← All tools';
    allToolsLink.setAttribute('aria-label', 'Back to all tools');
    document.querySelector('.topbar-actions')?.prepend(allToolsLink);
  }
  const setMessage = (id, message, type = '') => {
    const el = $(id); if (!el) return;
    el.textContent = message; el.className = 'tool-output' + (type ? ' ' + type : '');
  };
  const money = value => new Intl.NumberFormat('en-BD',{style:'currency',currency:'BDT',maximumFractionDigits:2}).format(value);
  const positive = id => { const el = $(id); return el && el.value.trim() !== '' && Number.isFinite(Number(el.value)) && Number(el.value) >= 0; };

  // Theme preference is local to this browser, shared with the main DRQR page.
  const themeToggle = $('themeToggle');
  function applyTheme(light) {
    document.body.classList.toggle('light-mode', light);
    if (themeToggle) {
      themeToggle.textContent = light ? '🌙 Black Mode' : '☀️ White Mode';
      themeToggle.setAttribute('aria-pressed', String(light));
      themeToggle.setAttribute('aria-label', light ? 'Switch to black mode' : 'Switch to white mode');
    }
  }
  let savedTheme = null;
  try { savedTheme = localStorage.getItem('drqr-theme'); } catch (_) {}
  applyTheme(savedTheme === 'light');
  themeToggle?.addEventListener('click', () => {
    const light = !document.body.classList.contains('light-mode');
    applyTheme(light); try { localStorage.setItem('drqr-theme', light ? 'light' : 'dark'); } catch (_) {}
  });

  // QR creation
  let qrInstance = null;
  $('makeQr').addEventListener('click', () => {
    const text = $('qrText').value.trim(), preview = $('customQrPreview');
    preview.replaceChildren(); qrInstance = null;
    if (!text) return setMessage('qrMakerStatus','Please enter text or an ID.','error');
    if (typeof QRCode === 'undefined') return setMessage('qrMakerStatus','QR library did not load. Check your internet connection.','error');
    const size = Number($('qrSize').value) || 260;
    qrInstance = new QRCode(preview,{text,width:size,height:size,correctLevel:QRCode.CorrectLevel.M});
    setMessage('qrMakerStatus','QR code created. You can download it as a PNG.','success');
  });
  $('downloadQr').addEventListener('click', () => {
    const preview = $('customQrPreview'), canvas = preview.querySelector('canvas'), img = preview.querySelector('img');
    let url = '';
    if (canvas) url = canvas.toDataURL('image/png');
    else if (img && img.src.startsWith('data:')) url = img.src;
    if (!url) return setMessage('qrMakerStatus','Create a QR code first.','error');
    const a = document.createElement('a');
    const name = ($('qrFileName').value.trim() || 'drqr-code').replace(/[^a-z0-9_-]+/gi,'-').slice(0,60);
    a.href = url; a.download = name + '.png'; document.body.appendChild(a); a.click(); a.remove();
  });

  // Camera QR scanner; BarcodeDetector is browser-dependent.
  let stream = null, scanActive = false, detector = null;
  const video = $('scannerVideo');
  $('startScanner').addEventListener('click', async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setMessage('scannerResult','Camera access is unavailable. Open this page over HTTPS in a supported browser.','error');
    if (!('BarcodeDetector' in window)) return setMessage('scannerResult','This browser does not support native QR detection. Try a compatible Chromium-based browser or a future scanner-library fallback.','error');
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      if (!supported.includes('qr_code')) return setMessage('scannerResult','QR detection is not supported by this browser.','error');
      detector = new BarcodeDetector({formats:['qr_code']});
      stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      video.srcObject = stream; video.classList.remove('hidden'); await video.play();
      scanActive = true; setMessage('scannerResult','Camera is active. Point it at a QR code…');
      scanFrame();
    } catch (err) {
      stopScanner();
      setMessage('scannerResult', err?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser settings.' : 'Could not start the camera. Check camera permissions and try again.','error');
    }
  });
  async function scanFrame() {
    if (!scanActive || !detector || video.readyState < 2) {
      if (scanActive) requestAnimationFrame(scanFrame);
      return;
    }
    try {
      const codes = await detector.detect(video);
      if (codes.length && codes[0].rawValue) {
        const value = codes[0].rawValue;
        setMessage('scannerResult','Scanned: ' + value,'success');
        stopScanner();
        return;
      }
    } catch (_) {}
    if (scanActive) requestAnimationFrame(scanFrame);
  }
  function stopScanner() {
    scanActive = false;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null; video.srcObject = null; video.classList.add('hidden');
  }
  $('stopScanner').addEventListener('click', () => { stopScanner(); setMessage('scannerResult','Camera stopped.'); });
  window.addEventListener('pagehide', stopScanner);

  // ID formatter: normalize whitespace, uppercase, de-duplicate while preserving order.
  $('formatIds').addEventListener('click', () => {
    const lines = $('idsInput').value.split(/[\r\n,;]+/).map(v => v.trim().replace(/\s+/g,'').toUpperCase()).filter(Boolean);
    const unique = [...new Set(lines)];
    $('idsOutput').value = unique.join('\n');
    setMessage('formatterStatus', unique.length ? 'Formatted ' + unique.length + ' unique ID(s).' : 'Enter at least one ID. ', unique.length ? 'success' : 'error');
  });
  $('copyFormatted').addEventListener('click', async () => {
    const value = $('idsOutput').value;
    if (!value) return setMessage('formatterStatus','Format IDs first.','error');
    try { await navigator.clipboard.writeText(value); setMessage('formatterStatus','Formatted IDs copied.','success'); }
    catch (_) { $('idsOutput').focus(); $('idsOutput').select(); setMessage('formatterStatus','Select the text and copy it manually.','error'); }
  });

  // Code 128 barcode
  $('makeBarcode').addEventListener('click', () => {
    const value = $('barcodeText').value.trim(), preview = $('barcodePreview');
    preview.replaceChildren();
    if (!value) return setMessage('barcodeStatus','Enter a value first.','error');
    if (typeof JsBarcode === 'undefined') return setMessage('barcodeStatus','Barcode library did not load. Check your internet connection.','error');
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); preview.appendChild(svg);
    try {
      JsBarcode(svg,value,{format:'CODE128',displayValue:true,margin:12,background:'#ffffff',lineColor:'#111827',fontSize:14});
      setMessage('barcodeStatus','Barcode generated. Download as SVG when ready.','success');
    } catch (_) { preview.replaceChildren(); setMessage('barcodeStatus','Could not encode this value. Check the text and try again.','error'); }
  });
  $('downloadBarcode').addEventListener('click', () => {
    const svg = $('barcodePreview').querySelector('svg');
    if (!svg) return setMessage('barcodeStatus','Generate a barcode first.','error');
    const copy = svg.cloneNode(true); copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
    const blob = new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml;charset=utf-8'});
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'drqr-barcode.svg'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });

  $('calculateFuel').addEventListener('click', () => {
    if (!positive('fuelDistance') || !positive('fuelMileage') || Number($('fuelMileage').value) <= 0 || !positive('fuelPrice'))
      return setMessage('fuelResult','Enter valid non-negative distance and fuel price, and mileage greater than zero.','error');
    const km = Number($('fuelDistance').value), mileage = Number($('fuelMileage').value), price = Number($('fuelPrice').value);
    const litres = km / mileage, cost = litres * price;
    setMessage('fuelResult','Estimated fuel needed: ' + litres.toFixed(2) + ' litre(s)\nEstimated fuel cost: ' + money(cost),'success');
  });

  $('calculateIncome').addEventListener('click', () => {
    const ids = ['incomeBase','incomeBonus','incomeFuel','incomeOther'];
    if (ids.some(id => !positive(id))) return setMessage('incomeResult','Enter valid non-negative amounts in all fields. Use 0 if an item does not apply.','error');
    const base = Number($('incomeBase').value), bonus = Number($('incomeBonus').value);
    const fuel = Number($('incomeFuel').value), other = Number($('incomeOther').value);
    const gross = base + bonus, expenses = fuel + other, net = gross - expenses;
    setMessage('incomeResult','Gross income: ' + money(gross) + '\nTotal expenses: ' + money(expenses) + '\nNet income: ' + money(net),'success');
  });

  // Notes are stored only in this browser's localStorage.
  try { $('notesInput').value = localStorage.getItem('drqr-quick-notes') || ''; } catch (_) {}
  $('saveNotes').addEventListener('click', () => {
    try { localStorage.setItem('drqr-quick-notes',$('notesInput').value); setMessage('notesStatus','Notes saved on this device/browser only.','success'); }
    catch (_) { setMessage('notesStatus','Browser storage is unavailable. Copy your note to keep it.','error'); }
  });
  $('clearNotes').addEventListener('click', () => {
    $('notesInput').value = '';
    try { localStorage.removeItem('drqr-quick-notes'); setMessage('notesStatus','Saved notes cleared from this browser.','success'); }
    catch (_) { setMessage('notesStatus','Could not clear browser storage.','error'); }
  });

  // Approximate download throughput using temporary data from Cloudflare.
  let speedController = null;
  $('runSpeedTest').addEventListener('click', async () => {
    const btn = $('runSpeedTest'), bytes = Number($('speedSize').value);
    btn.disabled = true; btn.textContent = 'Testing…';
    setMessage('speedResult','Downloading a temporary test file. Please wait…');
    speedController = new AbortController();
    const timer = setTimeout(() => speedController?.abort(),20000);
    const start = performance.now();
    try {
      const response = await fetch('https://speed.cloudflare.com/__down?bytes=' + bytes + '&cachebust=' + Date.now(),{cache:'no-store',signal:speedController.signal});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.arrayBuffer();
      const elapsed = (performance.now() - start) / 1000;
      if (!data.byteLength || elapsed <= 0) throw new Error('No test data received');
      const mbps = (data.byteLength * 8 / elapsed) / 1000000;
      setMessage('speedResult','Estimated download speed: ' + mbps.toFixed(2) + ' Mbps\nDownloaded: ' + (data.byteLength / 1000000).toFixed(2) + ' MB in ' + elapsed.toFixed(2) + ' seconds.','success');
    } catch (err) {
      setMessage('speedResult',err?.name === 'AbortError' ? 'Test timed out. Try a smaller download size or a more stable connection.' : 'Speed test could not complete. The server, CORS policy, browser or network may have blocked the request.','error');
    } finally {
      clearTimeout(timer); speedController = null; btn.disabled = false; btn.textContent = 'Start speed test';
    }
  });
})();