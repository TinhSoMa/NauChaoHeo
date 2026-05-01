#!/usr/bin/env node

/**
 * Context Indexer - Tạo index để AI đọc context nhanh
 * 
 * Usage:
 *   node scripts/index-context.js          # Build index
 *   node scripts/index-context.js search [keyword]  # Search
 */

const fs = require('fs');
const path = require('path');

// Paths
const SKILL_ROOT = path.join(__dirname, '..');
// Knowledge Base Path (Single JSON Source)
const KNOWLEDGE_BASE_FILE = path.join(SKILL_ROOT, 'lessons-learned', 'knowledge-base.json');
const INDEX_FILE = path.join(SKILL_ROOT, 'context-index.json');

/**
 * Build index from all context files
 */
function buildIndex() {
  console.log('🔍 Building context index...\n');

  const index = {
    metadata: {
      lastUpdated: new Date().toISOString(),
      totalFiles: 0,
      totalKnowledgeItems: 0,
    },
    quickAccess: {
      projectOverview: null,
      currentWork: null,
      conventions: null,
      recentItems: [],
    },
    categories: {
      projectContext: [],
      knowledgeBase: [], // Main knowledge array
    },
    searchIndex: {},
  };

  // 1. Index knowledge-base.json (The Single Source of Truth for Lessons)
  if (fs.existsSync(KNOWLEDGE_BASE_FILE)) {
    console.log(`Reading Knowledge Base: ${KNOWLEDGE_BASE_FILE}`);
    try {
      const knowledgeData = JSON.parse(fs.readFileSync(KNOWLEDGE_BASE_FILE, 'utf-8'));
      
      knowledgeData.forEach(item => {
        const entry = {
          id: item.id || `kb-${Math.random()}`,
          source: 'knowledge-base',
          date: item.date || new Date().toISOString().split('T')[0],
          category: item.category || 'general',
          title: item.title || 'Untitled',
          summary: item.content ? item.content.substring(0, 200) + '...' : '',
          fullContent: item.content, // Keep content purely for search indexing logic below
          keywords: item.tags || [],
        };

        index.categories.knowledgeBase.push(entry);
        
        // Add to recent items
        if (index.quickAccess.recentItems.length < 5) {
          index.quickAccess.recentItems.push(entry);
        }

        // Search index
        indexForSearch(entry, item.content || '', index.searchIndex);
      });
      console.log(`✓ Indexed Knowledge Base: ${knowledgeData.length} items`);
    } catch (e) {
      console.error('❌ Error reading knowledge-base.json:', e.message);
    }
  } else {
    console.log('⚠️ knowledge-base.json not found. Creating empty one...');
    fs.writeFileSync(KNOWLEDGE_BASE_FILE, '[]');
  }

  // 2. Index project-context files (Keep as MD for human readability)
  const projectContextDir = path.join(SKILL_ROOT, 'project-context');
  if (fs.existsSync(projectContextDir)) {
    const files = fs.readdirSync(projectContextDir);
    
    files.forEach(file => {
      if (file.endsWith('.md') && !file.includes('template')) {
        const filePath = path.join(projectContextDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        
        const entry = {
          file: `project-context/${file}`,
          title: extractTitle(content),
          summary: extractSummary(content),
          keywords: extractKeywords(content),
          size: content.length,
          lastModified: fs.statSync(filePath).mtime,
        };

        index.categories.projectContext.push(entry);
        
        // Quick access
        if (file.includes('overview')) {
          index.quickAccess.projectOverview = entry;
        } else if (file.includes('progress') || file.includes('work-in-progress')) {
          index.quickAccess.currentWork = entry;
        } else if (file.includes('conventions')) {
          index.quickAccess.conventions = entry;
        }

        // Build search index
        indexForSearch(entry, content, index.searchIndex);
        
        console.log(`✓ Indexed: ${file}`);
      }
    });
  }

  // Sort recent items
  index.quickAccess.recentItems.sort((a, b) => 
    new Date(b.date || 0) - new Date(a.date || 0)
  );
  
  // Update metadata
  index.metadata.totalFiles = index.categories.projectContext.length;
  index.metadata.totalKnowledgeItems = index.categories.knowledgeBase.length;

  // Save index
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  
  console.log('\n✅ Index built successfully!');
  console.log(`   Items in Knowledge Base: ${index.metadata.totalKnowledgeItems}`);
  console.log(`   Project Files: ${index.metadata.totalFiles}`);
  console.log(`   Index saved to: context-index.json\n`);
  
  return index;
}

/**
 * Simple CSV Parser (Unused but kept from legacy)
 */
function parseCsvLine(line) {
  // ... (kept for compatibility if needed)
  return [];
}


/**
 * Search in index
 */
function search(keyword) {
  if (!fs.existsSync(INDEX_FILE)) {
    console.error('❌ Index not found. Run without arguments to build index first.');
    return;
  }

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
  const results = [];
  
  const searchTerm = keyword.toLowerCase();
  
  // Search in project context
  index.categories.projectContext.forEach(entry => {
    if (matches(entry, searchTerm)) {
      results.push({ ...entry, relevance: calculateRelevance(entry, searchTerm) });
    }
  });
  
  // Search in knowledge base
  index.categories.knowledgeBase.forEach(entry => {
     if (matches(entry, searchTerm)) {
      results.push({ ...entry, relevance: calculateRelevance(entry, searchTerm) });
     }
  });
  
  // Sort by relevance
  results.sort((a, b) => b.relevance - a.relevance);
  
  console.log(`\n🔍 Search results for: "${keyword}"\n`);
  
  if (results.length === 0) {
    console.log('No results found.');
    return;
  }
  
  results.slice(0, 10).forEach((result, i) => {
    console.log(`${i + 1}. ${result.title}`);
    console.log(`   📁 ${result.file || result.source}`);
    console.log(`   📝 ${result.summary}`);
    if (result.category) {
      console.log(`   🏷️  ${result.category}`);
    }
    console.log(`   ⭐ Relevance: ${result.relevance.toFixed(2)}`);
    console.log('');
  });
  
  console.log(`Found ${results.length} results (showing top 10)\n`);
}

/**
 * Show quick summary
 */
function showQuickSummary() {
  if (!fs.existsSync(INDEX_FILE)) {
    console.error('❌ Index not found. Building index...\n');
    buildIndex();
    return;
  }

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
  
  console.log('\n📊 Context Summary\n');
  console.log('─'.repeat(50));
  
  // Project Overview
  if (index.quickAccess.projectOverview) {
    console.log('\n🎯 PROJECT OVERVIEW:');
    console.log(`   ${index.quickAccess.projectOverview.title}`);
    console.log(`   ${index.quickAccess.projectOverview.summary}`);
  }
  
  // Current Work
  if (index.quickAccess.currentWork) {
    console.log('\n🚧 CURRENT WORK:');
    console.log(`   ${index.quickAccess.currentWork.title}`);
    console.log(`   ${index.quickAccess.currentWork.summary}`);
  }
  
  // Recent Lessons
  console.log('\n📚 RECENT KNOWLEDGE ITEMS:');
  if (index.quickAccess.recentItems) {
    index.quickAccess.recentItems.slice(0, 5).forEach((item, i) => {
      console.log(`   ${i + 1}. [${item.category}] ${item.title}`);
    });
  }
  
  // Stats
  console.log('\n📈 STATS:');
  console.log(`   Project Files: ${index.metadata.totalFiles}`);
  console.log(`   Knowledge Base Items: ${index.metadata.totalKnowledgeItems}`);
  console.log(`   Last updated: ${new Date(index.metadata.lastUpdated).toLocaleString()}`);
  
  console.log('\n─'.repeat(50));
  console.log('\n💡 Commands:');
  console.log('   node scripts/index-context.js            # Rebuild index');
  console.log('   node scripts/index-context.js search IPC # Search for keyword');
  console.log('   node scripts/index-context.js summary    # Show this summary');
  console.log('');
}

// Helper functions (Simplified for brevity)
function extractTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}

function extractSummary(content) {
  const lines = content.split('\n');
  let summary = '';
  let foundTitle = false;
  for (const line of lines) {
    if (line.startsWith('#')) { foundTitle = true; continue; }
    if (foundTitle && line.trim() && !line.startsWith('**') && !line.startsWith('>')) {
      summary = line.trim();
      break;
    }
  }
  return summary.substring(0, 150) + (summary.length > 150 ? '...' : '');
}

function extractKeywords(content) {
  return []; // Simplified
}

function indexForSearch(entry, content, searchIndex) {
  // Simplified
}

function matches(entry, searchTerm) {
  return (
    entry.title.toLowerCase().includes(searchTerm) ||
    entry.summary.toLowerCase().includes(searchTerm) ||
    (entry.category && entry.category.toLowerCase().includes(searchTerm))
  );
}

function calculateRelevance(entry, searchTerm) {
  return 10; // Simplified
}

// Main
const command = process.argv[2];
const arg = process.argv[3];

if (command === 'search' && arg) {
  search(arg);
} else if (command === 'summary') {
  showQuickSummary();
} else {
  buildIndex();
  showQuickSummary();
}
