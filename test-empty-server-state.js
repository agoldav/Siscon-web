'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

assert(!html.includes("if(!_apiOk || !(Array.isArray(projects)&&projects.length)) loadData();"));
assert(!html.includes("if(!_apiOk||!(Array.isArray(projects)&&projects.length))loadData();"));
assert.equal((html.match(/if\(!_apiOk\) loadData\(\);/g) || []).length, 2);
assert.equal((html.match(/if\(!_apiOk2\)loadData\(\);/g) || []).length, 1);
assert(html.includes('Una respuesta válida con 0 proyectos es el estado canónico'));

console.log('OK: una respuesta remota válida con 0 proyectos no restaura localStorage antiguo');
