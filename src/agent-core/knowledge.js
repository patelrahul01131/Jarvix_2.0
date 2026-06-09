const fs = require('fs');
const path = require('path');

function getProjectKnowledge(workspaceRoot) {
  const knowledge = {
    framework: 'Unknown',
    language: 'Unknown',
    database: 'Unknown',
    testing: 'Unknown',
    architecture: 'Unknown',
  };

  if (!workspaceRoot) return knowledge;

  try {
    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      // Language
      if (deps['typescript']) knowledge.language = 'TypeScript';
      else knowledge.language = 'JavaScript';

      // Framework
      if (deps['react']) knowledge.framework = 'React';
      if (deps['next']) knowledge.framework = 'Next.js';
      if (deps['vue']) knowledge.framework = 'Vue';
      if (deps['@angular/core']) knowledge.framework = 'Angular';
      if (deps['express']) knowledge.framework += (knowledge.framework !== 'Unknown' ? ' + Express' : 'Express');
      if (deps['@nestjs/core']) knowledge.framework = 'NestJS';

      // Database
      if (deps['mongoose']) knowledge.database = 'MongoDB (Mongoose)';
      if (deps['pg'] || deps['sequelize']) knowledge.database = 'PostgreSQL/SQL';
      if (deps['prisma']) knowledge.database = 'Prisma ORM';
      if (deps['firebase']) knowledge.database = 'Firebase';

      // Testing
      if (deps['jest']) knowledge.testing = 'Jest';
      if (deps['mocha']) knowledge.testing = 'Mocha';
      if (deps['cypress']) knowledge.testing += (knowledge.testing !== 'Unknown' ? ' + Cypress' : 'Cypress');
      if (deps['vitest']) knowledge.testing = 'Vitest';

      // Architecture
      if (deps['redux'] || deps['@reduxjs/toolkit']) knowledge.architecture = 'Redux State Management';
      else if (deps['mobx']) knowledge.architecture = 'MobX';
      else if (deps['graphql']) knowledge.architecture = 'GraphQL API';
      else knowledge.architecture = 'Standard Node/React';
    }
  } catch (error) {
    console.error("Failed to read project knowledge:", error);
  }

  return knowledge;
}

module.exports = { getProjectKnowledge };
