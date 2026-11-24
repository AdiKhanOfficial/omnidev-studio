/**
 * OmniDev Studio — Web UI / Dashboard Scaffolding
 *
 * Generates complete, professional admin-dashboard layouts from curated
 * prebuilt themes (AdminLTE, Bootstrap 5, Tailwind) so an app looks like a
 * real developer built it — not an ad-hoc AI mock-up. Files are written into
 * the active workspace.
 */

const fs = require('fs');
const path = require('path');
const workspaceManager = require('../workspace');

const TEMPLATES = {
  adminlte: {
    name: 'AdminLTE 3',
    framework: 'Bootstrap 4 · AdminLTE',
    description: 'The classic, battle-tested admin panel. Sidebar, info boxes, charts, tables.'
  },
  bootstrap5: {
    name: 'Bootstrap 5 Clean',
    framework: 'Bootstrap 5.3',
    description: 'Modern, lightweight Bootstrap 5 admin with a clean sidebar and stat cards.'
  },
  tailwind: {
    name: 'Tailwind Modern',
    framework: 'Tailwind CSS 3',
    description: 'Sleek, modern dashboard with a dark sidebar, soft cards and a line chart.'
  }
};

const STAT_CARDS = [
  { label: 'Total Revenue', value: '$48,290', delta: '+12.5%', icon: 'cash', color: '#1D9E75' },
  { label: 'New Orders', value: '1,482', delta: '+8.2%', icon: 'cart', color: '#378ADD' },
  { label: 'Active Users', value: '9,318', delta: '+3.1%', icon: 'users', color: '#7F77DD' },
  { label: 'Bounce Rate', value: '24.6%', delta: '-1.4%', icon: 'activity', color: '#D85A30' }
];
const NAV = ['Dashboard', 'Orders', 'Products', 'Customers', 'Reports', 'Settings'];
const ROWS = [
  ['#1024', 'Ali Raza', 'Premium Plan', 'Paid', '$199'],
  ['#1025', 'Sara Khan', 'Starter Plan', 'Pending', '$49'],
  ['#1026', 'John Doe', 'Business Plan', 'Paid', '$399'],
  ['#1027', 'Maria Lopez', 'Premium Plan', 'Refunded', '$199'],
  ['#1028', 'Chen Wei', 'Starter Plan', 'Paid', '$49']
];

function adminlteHtml(app) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${app} — Dashboard</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/admin-lte/3.2.0/css/adminlte.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
</head>
<body class="hold-transition sidebar-mini layout-fixed">
<div class="wrapper">
  <nav class="main-header navbar navbar-expand navbar-white navbar-light">
    <ul class="navbar-nav">
      <li class="nav-item"><a class="nav-link" data-widget="pushmenu" href="#"><i class="fas fa-bars"></i></a></li>
    </ul>
    <ul class="navbar-nav ml-auto">
      <li class="nav-item"><a class="nav-link" href="#"><i class="far fa-bell"></i></a></li>
      <li class="nav-item"><a class="nav-link" href="#"><i class="far fa-user"></i> Admin</a></li>
    </ul>
  </nav>
  <aside class="main-sidebar sidebar-dark-primary elevation-4">
    <a href="#" class="brand-link"><span class="brand-text font-weight-light">&nbsp;${app}</span></a>
    <div class="sidebar"><nav class="mt-2"><ul class="nav nav-pills nav-sidebar flex-column">
      ${NAV.map((n, i) => `<li class="nav-item"><a href="#" class="nav-link${i === 0 ? ' active' : ''}"><i class="nav-icon fas fa-${['tachometer-alt', 'shopping-cart', 'box', 'users', 'chart-bar', 'cog'][i]}"></i><p>${n}</p></a></li>`).join('\n      ')}
    </ul></nav></div>
  </aside>
  <div class="content-wrapper">
    <section class="content-header"><div class="container-fluid"><h1>Dashboard</h1></div></section>
    <section class="content"><div class="container-fluid">
      <div class="row">
        ${STAT_CARDS.map(c => `<div class="col-lg-3 col-6"><div class="small-box" style="background:${c.color};color:#fff"><div class="inner"><h3>${c.value}</h3><p>${c.label}</p></div><div class="icon"><i class="fas fa-${c.icon === 'cash' ? 'dollar-sign' : c.icon === 'cart' ? 'shopping-cart' : c.icon === 'users' ? 'users' : 'chart-line'}"></i></div></div></div>`).join('\n        ')}
      </div>
      <div class="row">
        <div class="col-md-8"><div class="card"><div class="card-header"><h3 class="card-title">Revenue Overview</h3></div><div class="card-body"><canvas id="chart" height="100"></canvas></div></div></div>
        <div class="col-md-4"><div class="card"><div class="card-header"><h3 class="card-title">Recent Orders</h3></div><div class="card-body p-0"><table class="table table-striped">
          <thead><tr><th>Order</th><th>Customer</th><th>Status</th></tr></thead>
          <tbody>${ROWS.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td><span class="badge badge-${r[3] === 'Paid' ? 'success' : r[3] === 'Pending' ? 'warning' : 'danger'}">${r[3]}</span></td></tr>`).join('')}</tbody>
        </table></div></div></div>
      </div>
    </div></section>
  </div>
  <footer class="main-footer"><strong>${app}</strong> — built with OmniDev Studio.</footer>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/admin-lte/3.2.0/js/adminlte.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script>
new Chart(document.getElementById('chart'),{type:'line',data:{labels:['Jan','Feb','Mar','Apr','May','Jun'],datasets:[{label:'Revenue',data:[12,19,15,25,22,30],borderColor:'#1D9E75',backgroundColor:'rgba(29,158,117,.1)',fill:true,tension:.4}]},options:{plugins:{legend:{display:false}}}});
</script>
</body>
</html>`;
}

function bootstrap5Html(app) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${app} — Dashboard</title>
<link href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.3/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap-icons/1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
<style>
body{background:#f4f6fb}.sidebar{width:240px;min-height:100vh;background:#1e2a44}.sidebar a{color:#aab6d3;padding:.7rem 1.2rem;display:flex;gap:.6rem;align-items:center;text-decoration:none;border-radius:8px;margin:2px 10px;font-size:.92rem}.sidebar a.active,.sidebar a:hover{background:#2c3c61;color:#fff}.stat{border:0;border-radius:14px}.stat .ic{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.3rem}
</style>
</head>
<body>
<div class="d-flex">
  <div class="sidebar text-white">
    <div class="p-3 fs-5 fw-semibold">${app}</div>
    ${NAV.map((n, i) => `<a href="#" class="${i === 0 ? 'active' : ''}"><i class="bi bi-${['speedometer2', 'bag', 'box-seam', 'people', 'bar-chart', 'gear'][i]}"></i>${n}</a>`).join('\n    ')}
  </div>
  <div class="flex-grow-1">
    <nav class="navbar bg-white border-bottom px-4 py-2"><span class="navbar-brand mb-0 h6">Dashboard</span><div class="ms-auto d-flex align-items-center gap-3"><i class="bi bi-bell"></i><i class="bi bi-person-circle fs-5"></i></div></nav>
    <div class="p-4">
      <div class="row g-3 mb-4">
        ${STAT_CARDS.map(c => `<div class="col-md-3"><div class="card stat shadow-sm"><div class="card-body d-flex align-items-center gap-3"><div class="ic" style="background:${c.color}22;color:${c.color}"><i class="bi bi-${c.icon === 'cash' ? 'cash-stack' : c.icon === 'cart' ? 'cart' : c.icon === 'users' ? 'people' : 'activity'}"></i></div><div><div class="text-muted small">${c.label}</div><div class="fs-5 fw-semibold">${c.value}</div><div class="small" style="color:${c.color}">${c.delta}</div></div></div></div></div>`).join('\n        ')}
      </div>
      <div class="row g-3">
        <div class="col-lg-8"><div class="card stat shadow-sm"><div class="card-body"><h6 class="fw-semibold mb-3">Revenue Overview</h6><canvas id="chart" height="110"></canvas></div></div></div>
        <div class="col-lg-4"><div class="card stat shadow-sm"><div class="card-body"><h6 class="fw-semibold mb-3">Recent Orders</h6><table class="table table-sm align-middle mb-0">
          <thead><tr class="text-muted small"><th>Order</th><th>Customer</th><th>Status</th></tr></thead>
          <tbody>${ROWS.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td><span class="badge rounded-pill bg-${r[3] === 'Paid' ? 'success' : r[3] === 'Pending' ? 'warning text-dark' : 'danger'}">${r[3]}</span></td></tr>`).join('')}</tbody>
        </table></div></div></div>
      </div>
    </div>
  </div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script>new Chart(document.getElementById('chart'),{type:'line',data:{labels:['Jan','Feb','Mar','Apr','May','Jun'],datasets:[{label:'Revenue',data:[12,19,15,25,22,30],borderColor:'#378ADD',backgroundColor:'rgba(55,138,221,.1)',fill:true,tension:.4}]},options:{plugins:{legend:{display:false}}}});</script>
</body>
</html>`;
}

function tailwindHtml(app) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${app} — Dashboard</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-100">
<div class="flex min-h-screen">
  <aside class="w-60 bg-slate-900 text-slate-300 flex flex-col">
    <div class="px-5 py-4 text-white text-lg font-semibold">${app}</div>
    <nav class="flex-1 px-3 space-y-1">
      ${NAV.map((n, i) => `<a href="#" class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${i === 0 ? 'bg-slate-700 text-white' : 'hover:bg-slate-800'}">${n}</a>`).join('\n      ')}
    </nav>
  </aside>
  <div class="flex-1">
    <header class="bg-white border-b px-6 py-3 flex items-center">
      <h1 class="font-semibold text-slate-700">Dashboard</h1>
      <div class="ml-auto flex items-center gap-4 text-slate-500"><span>🔔</span><span class="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center text-sm">A</span></div>
    </header>
    <main class="p-6">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        ${STAT_CARDS.map(c => `<div class="bg-white rounded-2xl p-5 shadow-sm"><div class="text-sm text-slate-500">${c.label}</div><div class="text-2xl font-semibold mt-1">${c.value}</div><div class="text-sm mt-1" style="color:${c.color}">${c.delta}</div></div>`).join('\n        ')}
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 bg-white rounded-2xl p-5 shadow-sm"><h2 class="font-semibold mb-4 text-slate-700">Revenue Overview</h2><canvas id="chart" height="110"></canvas></div>
        <div class="bg-white rounded-2xl p-5 shadow-sm"><h2 class="font-semibold mb-4 text-slate-700">Recent Orders</h2><div class="space-y-3 text-sm">
          ${ROWS.map(r => `<div class="flex items-center justify-between"><div><div class="font-medium">${r[1]}</div><div class="text-slate-400 text-xs">${r[0]} · ${r[2]}</div></div><span class="px-2 py-0.5 rounded-full text-xs ${r[3] === 'Paid' ? 'bg-green-100 text-green-700' : r[3] === 'Pending' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}">${r[3]}</span></div>`).join('\n          ')}
        </div></div>
      </div>
    </main>
  </div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script>new Chart(document.getElementById('chart'),{type:'line',data:{labels:['Jan','Feb','Mar','Apr','May','Jun'],datasets:[{label:'Revenue',data:[12,19,15,25,22,30],borderColor:'#7F77DD',backgroundColor:'rgba(127,119,221,.12)',fill:true,tension:.4}]},options:{plugins:{legend:{display:false}}}});</script>
</body>
</html>`;
}

const GENERATORS = { adminlte: adminlteHtml, bootstrap5: bootstrap5Html, tailwind: tailwindHtml };

module.exports = {
  list_ui_templates: async () => {
    return {
      templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, ...t })),
      usage: 'Call scaffold_dashboard with one of the template ids to generate a full admin dashboard into the workspace.'
    };
  },

  scaffold_dashboard: async ({ template = 'bootstrap5', output_dir = '.', app_name = 'Admin Panel', filename = 'dashboard.html' }) => {
    const gen = GENERATORS[template];
    if (!gen) throw new Error(`Unknown template "${template}". Available: ${Object.keys(TEMPLATES).join(', ')}.`);

    const relPath = path.join(output_dir, filename).replace(/\\/g, '/');
    const fullPath = workspaceManager.resolvePath(relPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const html = gen(app_name);
    fs.writeFileSync(fullPath, html, 'utf8');
    workspaceManager.notifyChanged();

    return {
      success: true,
      template: TEMPLATES[template].name,
      framework: TEMPLATES[template].framework,
      file: relPath,
      lines: html.split('\n').length,
      message: `Generated a ${TEMPLATES[template].name} dashboard at ${relPath}. Open it in a browser — assets load from CDN. Customize the nav, stat cards, table and chart to fit your app.`
    };
  }
};
