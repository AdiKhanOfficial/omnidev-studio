const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

class ProjectsManager extends EventEmitter {
  constructor() {
    super();
    this.storageFile = path.join(process.cwd(), '.omnidev_projects.json');
    this.projects = [];
    this.activeProjectId = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf8');
        const data = JSON.parse(raw);
        this.projects = Array.isArray(data.projects) ? data.projects : [];
        this.activeProjectId = data.activeProjectId === undefined ? (this.projects[0]?.id || null) : data.activeProjectId;
      }
    } catch (e) {
      console.warn('Failed to load projects file, resetting to default:', e.message);
      this.projects = [];
      this.activeProjectId = null;
    }
  }

  save() {
    try {
      const data = {
        activeProjectId: this.activeProjectId,
        projects: this.projects
      };
      fs.writeFileSync(this.storageFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save projects:', e.message);
    }
  }

  list() {
    return this.projects.map(p => {
      let exists = false;
      try {
        exists = fs.existsSync(p.path);
      } catch {}
      return { ...p, exists };
    });
  }

  get(id) {
    return this.projects.find(p => p.id === id) || null;
  }

  getActive() {
    return this.get(this.activeProjectId);
  }

  create({ name, path: dirPath, description = '', notes = '', type = 'General' }) {
    if (!name || !dirPath) {
      throw new Error('Project name and directory path are required.');
    }

    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }

    const newProj = {
      id: `proj-${uuidv4().slice(0, 8)}`,
      name: name.trim(),
      path: resolved,
      description: description.trim(),
      notes: notes.trim(),
      type: type || 'General',
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString()
    };

    this.projects.unshift(newProj);
    this.activeProjectId = newProj.id;
    this.save();
    return newProj;
  }

  update(id, updates = {}) {
    const proj = this.get(id);
    if (!proj) throw new Error(`Project ${id} not found.`);

    if (updates.name) proj.name = updates.name.trim();
    if (updates.description !== undefined) proj.description = updates.description.trim();
    if (updates.notes !== undefined) proj.notes = updates.notes.trim();
    if (updates.path) {
      const resolved = path.resolve(updates.path);
      if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
      proj.path = resolved;
    }
    if (updates.type) proj.type = updates.type;

    this.save();
    this.emit('projectUpdated', proj);
    return proj;
  }

  delete(id) {
    const idx = this.projects.findIndex(p => p.id === id);
    if (idx >= 0) {
      this.projects.splice(idx, 1);
      if (this.activeProjectId === id) {
        this.activeProjectId = this.projects[0]?.id || null;
      }
      this.save();
      return true;
    }
    return false;
  }

  setActive(id) {
    if (id === null) {
      this.activeProjectId = null;
      this.save();
      return null;
    }
    const proj = this.get(id);
    if (!proj) throw new Error(`Project ${id} not found.`);
    this.activeProjectId = id;
    proj.lastOpenedAt = new Date().toISOString();
    this.save();
    this.emit('projectUpdated', proj);
    return proj;
  }
}

module.exports = new ProjectsManager();
