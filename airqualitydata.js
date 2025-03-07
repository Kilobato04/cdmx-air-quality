/**
 * CDMX Air Quality Data Retrieval
 * This file contains functions for retrieving real air quality data 
 * from Mexico City's air quality monitoring network via a CORS proxy.
 */

// Function to fetch and parse air quality data from CDMX website through our proxy
async function fetchAirQualityData(parameter = 'o3', year = '2025', month = '03', day = null, hour = null, station = null) {
  try {
    // Construct the URL for our proxy
    // Replace with your own proxy URL if different
    const proxyUrl = '/.netlify/functions/proxy';
    
    // Build the query parameters
    const params = new URLSearchParams({
      qtipo: 'HORARIOS',
      parametro: parameter,
      anio: year,
      qmes: month
    });
    
    // Add optional parameters if specified
    if (day) params.append('dia', day);
    if (hour) params.append('hora', hour);
    if (station) params.append('qestacion', station);
    
    // Combine proxy URL with parameters
    const url = `${proxyUrl}?${params.toString()}`;
    console.log(`Fetching data from: ${url}`);
    
    // Fetch the data from our proxy
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const html = await response.text();
    
    // Parse the HTML to extract data
    const data = parseAirQualityHtml(html, parameter, year, month, day);
    
    return data;
  } catch (error) {
    console.error('Error fetching data:', error);
    throw error;
  }
}

// Function to parse HTML response from aire.cdmx.gob.mx
function parseAirQualityHtml(html, parameter, year, month, specificDay = null) {
  const data = [];
  
  // Check if HTML is empty or too short
  if (!html || html.length < 100) {
    console.error('HTML response is empty or too short');
    return [];
  }
  
  // Log a preview of the HTML for debugging
  console.log('HTML preview:', html.substring(0, 300));
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  try {
    // Extract tables from the document
    const tables = doc.querySelectorAll('table');
    console.log(`Found ${tables.length} tables in HTML`);
    
    // Log more detailed info about each table
    for (let i = 0; i < tables.length; i++) {
      const rows = tables[i].querySelectorAll('tr');
      const firstRow = rows[0];
      const thCount = firstRow ? firstRow.querySelectorAll('th').length : 0;
      const tdCount = firstRow ? firstRow.querySelectorAll('td').length : 0;
      
      console.log(`Table ${i}: ${rows.length} rows, first row has ${thCount} th elements and ${tdCount} td elements`);
      console.log(`Table ${i} preview:`, tables[i].outerHTML.substring(0, 150));
    }
    
    if (tables.length === 0) {
      console.warn('No tables found in the HTML');
      return [];
    }
    
    // Let's try to identify the data table differently
    // It might be the second table or the largest table
    let dataTable = null;
    let maxCells = 0;
    
    for (let i = 0; i < tables.length; i++) {
      const rows = tables[i].querySelectorAll('tr');
      
      // Skip tables with very few rows
      if (rows.length < 3) continue;
      
      // Check the number of cells in the first data row (second row)
      const cellsInFirstDataRow = rows.length > 1 ? rows[1].querySelectorAll('td').length : 0;
      
      console.log(`Table ${i} has ${cellsInFirstDataRow} cells in the first data row`);
      
      // Select table with the most cells in data rows, likely our data table
      if (cellsInFirstDataRow > maxCells) {
        maxCells = cellsInFirstDataRow;
        dataTable = tables[i];
        console.log(`New candidate data table: Table ${i} with ${cellsInFirstDataRow} cells`);
      }
    }
    
    // If we still can't find a good data table, try the second table as fallback (common layout)
    if (!dataTable && tables.length >= 2) {
      dataTable = tables[1];
      console.log('Using second table as fallback data table');
    }
    
    if (!dataTable && tables.length > 0) {
      dataTable = tables[0];
      console.log('Using first table as last resort data table');
    }
    
    if (!dataTable) {
      console.warn('Could not identify any data table in the HTML');
      return [];
    }
    
    // Extract date information (day) from the HTML
    let day = '01'; // Default to first day if not found
    
    if (specificDay) {
      // If a specific day was requested, use that
      day = specificDay.toString().padStart(2, '0');
    } else {
      // Try multiple patterns to extract day
      const dayPatterns = [
        /Día:?\s*(\d+)/i,
        /Dia:?\s*(\d+)/i,
        /día\s*(\d+)/i,
        /dia\s*(\d+)/i,
        /day:?\s*(\d+)/i,
        /fecha:?\s*\d+\/(\d+)\/\d+/i
      ];
      
      for (const pattern of dayPatterns) {
        const match = html.match(pattern);
        if (match) {
          day = parseInt(match[1]).toString().padStart(2, '0');
          console.log(`Found day ${day} using pattern ${pattern}`);
          break;
        }
      }
    }
    
    console.log(`Processing data for date: ${year}-${month}-${day}`);
    
    // Try different approaches to extract station headers
    const rows = dataTable.querySelectorAll('tr');
    if (rows.length === 0) {
      console.warn('No rows found in data table');
      return [];
    }
    
    // Find header row - could be first row or another row with th elements
    let headerRow = null;
    let headerCells = null;
    
    for (let i = 0; i < Math.min(rows.length, 3); i++) {
      const thElements = rows[i].querySelectorAll('th');
      if (thElements.length > 2) {
        headerRow = rows[i];
        headerCells = thElements;
        console.log(`Found header row at index ${i} with ${thElements.length} columns`);
        break;
      }
    }
    
    // If no header row with th elements found, try first row with td elements
    if (!headerRow) {
      headerRow = rows[0];
      headerCells = headerRow.querySelectorAll('td');
      console.log(`Using first row as header with ${headerCells.length} td elements`);
    }
    
    // Extract stations from headers
    const stations = [];
    
    // Skip first column (hour column) if present
    for (let i = 1; i < headerCells.length; i++) {
      const stationText = headerCells[i].textContent.trim();
      // Clean up the text (remove special characters, extra spaces)
      const cleanStationText = stationText.replace(/[^\w\s]/g, '').trim();
      
      // Stations are usually 3-letter codes like "ACO", "MER", etc.
      if (cleanStationText.length > 0) {
        stations.push(cleanStationText);
      }
    }
    
    console.log(`Found ${stations.length} stations: ${stations.join(', ')}`);
    
    if (stations.length === 0 && headerCells.length > 1) {
      // If we couldn't identify station names, use generic names
      for (let i = 1; i < headerCells.length; i++) {
        stations.push(`Station${i}`);
      }
      console.log(`Using generic station names: ${stations.join(', ')}`);
    }
    
    if (stations.length === 0) {
      console.warn('No station headers found in the table');
      return [];
    }
    
    // Start from row after header
    const headerIndex = Array.from(rows).indexOf(headerRow);
    const startRowIndex = headerIndex + 1;
    
    console.log(`Starting data extraction from row ${startRowIndex}, found ${rows.length - startRowIndex} data rows`);
    
    // For each data row
    for (let i = startRowIndex; i < rows.length; i++) {
      const cells = rows[i].querySelectorAll('td');
      
      // Skip if no cells or very few cells
      if (cells.length <= 1) {
        console.log(`Skipping row ${i} with only ${cells.length} cells`);
        continue;
      }
      
      let hour;
      
      // Try to extract hour from first cell
      const hourText = cells[0].textContent.trim();
      console.log(`Row ${i} hour cell content: "${hourText}"`);
      
      // Try multiple patterns to extract hour
      const hourPatterns = [
        /^(\d{1,2})$/, // Simple number
        /(\d{1,2})/, // Number anywhere in text
        /(\d{1,2}):00/, // Time format
        /hora:?\s*(\d{1,2})/i, // "Hora: XX" format
      ];
      
      let hourFound = false;
      for (const pattern of hourPatterns) {
        const match = hourText.match(pattern);
        if (match) {
          hour = parseInt(match[1]);
          hourFound = true;
          console.log(`Extracted hour ${hour} using pattern ${pattern}`);
          break;
        }
      }
      
      // If still no hour found, try to use row index as hour
      if (!hourFound) {
        // Assuming rows might correspond to hours 0-23
        hour = (i - startRowIndex) % 24;
        console.log(`Using row index to determine hour: ${hour}`);
      }
      
      // Format hour with leading zero if needed
      const formattedHour = hour.toString().padStart(2, '0');
      
      // For each station (skipping first cell which is the hour)
      for (let j = 1; j < cells.length && j-1 < stations.length; j++) {
        const stationId = stations[j-1];
        const valueText = cells[j].textContent.trim();
        
        console.log(`Row ${i}, Station ${stationId}, Value: "${valueText}"`);
        
        // Skip empty or invalid values (often displayed as "-", "N/D", or similar)
        if (valueText && !['', '-', 'N/D', 'NR', 'NV', '**', 'NA', 'n/a'].includes(valueText.toLowerCase())) {
          try {
            // Parse the value (remove any non-numeric characters except decimal point)
            const cleanText = valueText.replace(/[^\d.]/g, '');
            
            if (cleanText) {
              // Parse as integer if it's a whole number
              const value = parseFloat(cleanText);
              
              if (!isNaN(value)) {
                // Create a date string in ISO format (YYYY-MM-DD)
                const dateString = `${year}-${month}-${day}`;
                
                // Add data point to our collection
                data.push({
                  date: dateString,
                  hour: formattedHour,
                  value: value,
                  station: stationId,
                  parameter: parameter
                });
                
                console.log(`Added data point: ${dateString} ${formattedHour}:00, ${stationId}, ${value}`);
              }
            }
          } catch (error) {
            console.error(`Error parsing value "${valueText}" for station ${stationId} at hour ${hour}:`, error);
          }
        }
      }
    }
    
    console.log(`Successfully extracted ${data.length} data points from HTML`);
  } catch (error) {
    console.error('Error parsing HTML:', error);
    return [];
  }
  
  return data;
}

// Function to process data and calculate statistics
function processAirQualityData(data) {
  if (!data || data.length === 0) {
    return { stations: {}, hourlyAverages: [] };
  }
  
  // Group by station
  const stationData = {};
  
  data.forEach(item => {
    if (!stationData[item.station]) {
      stationData[item.station] = [];
    }
    stationData[item.station].push(item);
  });
  
  // Calculate hourly averages across all stations
  const hourlyAverages = {};
  
  data.forEach(item => {
    const key = `${item.date} ${item.hour}`;
    if (!hourlyAverages[key]) {
      hourlyAverages[key] = {
        sum: item.value,
        count: 1
      };
    } else {
      hourlyAverages[key].sum += item.value;
      hourlyAverages[key].count += 1;
    }
  });
  
  const averagesArray = Object.entries(hourlyAverages).map(([key, data]) => {
    const [date, hour] = key.split(' ');
    return {
      date,
      hour,
      value: parseFloat((data.sum / data.count).toFixed(1)),
      stationCount: data.count
    };
  }).sort((a, b) => {
    // Sort by date then hour
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return parseInt(a.hour) - parseInt(b.hour);
  });
  
  return {
    stations: stationData,
    hourlyAverages: averagesArray
  };
}

// Function to get air quality category based on parameter and value
function getAirQualityCategory(parameter, value) {
  // Air quality categories based on Mexican standards
  const categories = {
    o3: [
      { max: 70, category: 'Good', color: '#00e400' },
      { max: 95, category: 'Moderate', color: '#ffff00' },
      { max: 154, category: 'Unhealthy for Sensitive Groups', color: '#ff7e00' },
      { max: 204, category: 'Unhealthy', color: '#ff0000' },
      { max: 404, category: 'Very Unhealthy', color: '#99004c' },
      { max: Infinity, category: 'Hazardous', color: '#7e0023' }
    ],
    pm10: [
      { max: 54, category: 'Good', color: '#00e400' },
      { max: 154, category: 'Moderate', color: '#ffff00' },
      { max: 254, category: 'Unhealthy for Sensitive Groups', color: '#ff7e00' },
      { max: 354, category: 'Unhealthy', color: '#ff0000' },
      { max: 424, category: 'Very Unhealthy', color: '#99004c' },
      { max: Infinity, category: 'Hazardous', color: '#7e0023' }
    ],
    pm25: [
      { max: 12, category: 'Good', color: '#00e400' },
      { max: 35.4, category: 'Moderate', color: '#ffff00' },
      { max: 55.4, category: 'Unhealthy for Sensitive Groups', color: '#ff7e00' },
      { max: 150.4, category: 'Unhealthy', color: '#ff0000' },
      { max: 250.4, category: 'Very Unhealthy', color: '#99004c' },
      { max: Infinity, category: 'Hazardous', color: '#7e0023' }
    ],
    nox: [
      { max: 53, category: 'Good', color: '#00e400' },
      { max: 100, category: 'Moderate', color: '#ffff00' },
      { max: 360, category: 'Unhealthy for Sensitive Groups', color: '#ff7e00' },
      { max: 649, category: 'Unhealthy', color: '#ff0000' },
      { max: 1249, category: 'Very Unhealthy', color: '#99004c' },
      { max: Infinity, category: 'Hazardous', color: '#7e0023' }
    ],
    co: [
      { max: 4.4, category: 'Good', color: '#00e400' },
      { max: 9.4, category: 'Moderate', color: '#ffff00' },
      { max: 12.4, category: 'Unhealthy for Sensitive Groups', color: '#ff7e00' },
      { max: 15.4, category: 'Unhealthy', color: '#ff0000' },
      { max: 30.4, category: 'Very Unhealthy', color: '#99004c' },
      { max: Infinity, category: 'Hazardous', color: '#7e0023' }
    ],
    so2: [
      { max: 35, category: 'Good', color: '#00e400' },
      { max: 75, category: 'Moderate', color: '#ffff00' },
      { max: 185, category: 'Unhealthy for Sensitive Groups', color: '#ff7e00' },
      { max: 304, category: 'Unhealthy', color: '#ff0000' },
      { max: 604, category: 'Very Unhealthy', color: '#99004c' },
      { max: Infinity, category: 'Hazardous', color: '#7e0023' }
    ]
  };
  
  // Default to ozone categories if parameter not found
  const thresholds = categories[parameter] || categories.o3;
  
  // Find the appropriate category
  for (const threshold of thresholds) {
    if (value <= threshold.max) {
      return {
        category: threshold.category,
        color: threshold.color
      };
    }
  }
  
  // Fallback for any unexpected values
  return { category: 'Unknown', color: '#808080' };
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = {
    fetchAirQualityData,
    parseAirQualityHtml,
    processAirQualityData,
    getAirQualityCategory
  };
} else {
  // If running in browser, add to global window object
  window.airQualityData = {
    fetch: fetchAirQualityData,
    parse: parseAirQualityHtml,
    process: processAirQualityData,
    getCategory: getAirQualityCategory
  };
}
