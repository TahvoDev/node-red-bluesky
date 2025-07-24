const shell = require('shelljs');
const path = require('path');

// Create necessary directories
shell.mkdir("-p", "dist");

// Copy all files from lib to dist
if (shell.test('-d', 'lib')) {
  shell.cp("-R", path.join("lib", "*"), "dist/");
}

// Copy HTML files
if (shell.test('-e', '*.html')) {
  shell.cp("-R", "*.html", "dist/");
}

// Copy package.json to dist
if (shell.test('-e', 'package.json')) {
  shell.cp("package.json", "dist/");
}

console.log("Static assets copied successfully!");
