/**
 * @module database/seeds/default_categories
 * @description Seed das categorias padrão do sistema (idempotente).
 */
'use strict';

const { execute, queryOne } = require('../connection');
const { DEFAULT_CATEGORIES } = require('../../shared/constants');
const { v4: uuidv4 } = require('uuid');

const seedDefaultCategories = () => {
  const already = queryOne('SELECT id FROM categories WHERE is_default = 1 LIMIT 1');
  if (already) {
    console.log('  ✅ Categorias padrão já existem.');
    return;
  }

  DEFAULT_CATEGORIES.forEach((cat) => {
    // Categoria pai
    execute(
      `INSERT OR IGNORE INTO categories(id, user_id, name, type, icon, color, parent_id, is_default, sort_order)
       VALUES (?, NULL, ?, ?, ?, ?, NULL, 1, ?)`,
      [cat.id, cat.name, cat.type, cat.icon, cat.color, DEFAULT_CATEGORIES.indexOf(cat)]
    );

    // Subcategorias
    (cat.subcategories || []).forEach((sub, i) => {
      execute(
        `INSERT OR IGNORE INTO categories(id, user_id, name, type, icon, color, parent_id, is_default, sort_order)
         VALUES (?, NULL, ?, ?, ?, ?, ?, 1, ?)`,
        [sub.id, sub.name, cat.type, sub.icon || cat.icon, cat.color, cat.id, i]
      );
    });
  });

  console.log('  ✅ Categorias padrão inseridas.');
};

module.exports = { seedDefaultCategories };
