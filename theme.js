// Tema anahtarı (light/dark)
(function(){
    const btn = document.getElementById('toggleTheme');
    if (!btn) return;
    let dark = true;
    btn.onclick = () => {
      dark = !dark;
      if (dark) {
        document.documentElement.style.setProperty('--ws-bg', '#0B1220');
        document.documentElement.style.setProperty('--ws-surface', '#0F1629');
        document.documentElement.style.setProperty('--ws-card', '#111827');
        document.documentElement.style.setProperty('--ws-border', '#2A3550');
        document.documentElement.style.setProperty('--ws-text', '#E5E7EB');
        document.documentElement.style.setProperty('--ws-muted', '#9CA3AF');
      } else {
        document.documentElement.style.setProperty('--ws-bg', '#F6F7FB');
        document.documentElement.style.setProperty('--ws-surface', '#FFFFFF');
        document.documentElement.style.setProperty('--ws-card', '#FFFFFF');
        document.documentElement.style.setProperty('--ws-border', '#E5E7EB');
        document.documentElement.style.setProperty('--ws-text', '#0B1220');
        document.documentElement.style.setProperty('--ws-muted', '#475569');
      }
    };
  
    const picker = document.getElementById('primaryPicker');
    if (picker) {
      picker.addEventListener('input', () => {
        const c = picker.value;
        document.documentElement.style.setProperty('--ws-primary', c);
        document.documentElement.style.setProperty('--ws-primary-2', c);
      });
    }
  })();