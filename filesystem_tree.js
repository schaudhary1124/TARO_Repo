const fs = require('fs').promises;
const path = require('path');

// Constants for tree visualization
const VERTICAL_LINE = '│   ';
const MIDDLE_ITEM = '├── ';
const LAST_ITEM = '└── ';
const EMPTY_SPACE = '    ';
const OUTPUT_FILENAME = 'unfiltered_taro_tree.txt';

let outputLines = [];

/**
 * Recursively scans a directory and collects a tree structure into the outputLines array.
 * ALL FILES AND DIRECTORIES, INCLUDING HIDDEN ONES, ARE INCLUDED.
 * @param {string} dirPath - The directory path to scan.
 * @param {string} prefix - The prefix string for the current indentation level.
 */
async function printTree(dirPath, prefix = '', isRoot = false) {
    try {
        let items = await fs.readdir(dirPath);
        
        // --- NO FILTERING IS APPLIED ---
        
        const sortedItems = items.sort();
        const totalItems = sortedItems.length;

        for (let i = 0; i < totalItems; i++) {
            const item = sortedItems[i];
            const fullPath = path.join(dirPath, item);
            const isLast = (i === totalItems - 1);
            
            // Determine the prefix style for the current item
            const itemPrefix = isLast ? LAST_ITEM : MIDDLE_ITEM;

            outputLines.push(`${prefix}${itemPrefix}${item}`);

            // Check if the item is a directory
            let stats;
            try {
                stats = await fs.stat(fullPath);
            } catch (statError) {
                // Ignore items we can't stat
                continue; 
            }

            if (stats.isDirectory()) {
                // Calculate the new prefix for the subdirectory's contents
                const nextPrefix = prefix + (isLast ? EMPTY_SPACE : VERTICAL_LINE);
                
                // Recurse into the subdirectory
                await printTree(fullPath, nextPrefix);
            }
        }
    } catch (err) {
        // Only show fatal errors
        if (!isRoot || err.code !== 'ENOENT') {
            outputLines.push(`\nError processing directory ${dirPath}: ${err.message}\n`);
        }
    }
}

// --- Main Execution ---
async function main() {
    const startPath = '.'; 
    const startTime = process.hrtime();

    outputLines.push(`Scanning current directory (UNFILTERED - ALL FILES INCLUDED)...\n`);
    outputLines.push(`TARO (UNFILTERED)`); 
    
    await printTree(startPath, '', true);
    
    const endTime = process.hrtime(startTime);
    const durationMs = (endTime[0] * 1000) + (endTime[1] / 1000000);
    
    const conclusion = `\nScan complete. Output saved to: ${OUTPUT_FILENAME} (Took ${durationMs.toFixed(2)}ms)`;
    outputLines.push(conclusion);
    
    try {
        await fs.writeFile(OUTPUT_FILENAME, outputLines.join('\n'));
        console.log(conclusion);
    } catch (writeError) {
        console.error(`\nFATAL ERROR: Could not write file ${OUTPUT_FILENAME}: ${writeError.message}`);
    }
}

main();