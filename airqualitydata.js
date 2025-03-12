/**
 * CDMX Air Quality Data Retrieval
 * This file contains functions for retrieving real air quality data 
 * from Mexico City's air quality monitoring network via a CORS proxy.
 */

// Function to fetch and parse air quality data from CDMX website through our proxy
async function fetchAirQualityData(parameter = 'o3', year = '2025', month = '03', day = null, hour = null, station = null) {
  try {
    // Construct the URL for our proxy
    const proxyUrl = '/.netlify/functions/proxy';
    
    // Build the query parameters with special handling for PM2.5
    let paramValue = parameter;
    
    // Fix parameter name for PM2.5
    if (parameter === 'pm25') {
      console.log('Translating pm25 parameter to pm2');
      paramValue = 'pm2';  // Use 'pm2' for PM2.5 as required by the official website
    }
    
    const params = new URLSearchParams({
      qtipo: 'HORARIOS',
      parametro: paramValue,
      anio: year,
      qmes: month
    });
    
    // Add optional parameters if specified
    if (day) params.append('dia', day);
    if (hour) params.append('hora', hour);
    if (station) params.append('qestacion', station);
    
    // Combine proxy URL with parameters
    const url = `${proxyUrl}?${params.toString()}`;
    console.log(`Fetching data from: ${url} (original parameter: ${parameter}, sent as: ${paramValue})`);
    
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
function parseAirQualityHtml(html, parameter, year, month, specificDay = null, specificHour = null, specificStation = null) {
  const data = [];
  // Add near the beginning of parseAirQualityHtml function
    console.log(`Parsing HTML for parameter: ${parameter}`);
    console.log(`First 200 characters of HTML: ${html.substring(0, 200)}`);
    // After the tables are found:
    if (tables.length > 0) {
      console.log(`First table structure preview: ${tables[0].outerHTML.substring(0, 300)}`);
    }
  
    // Check if HTML is empty or too short
    if (!html || html.length < 100) {
      console.error('HTML response is empty or too short');
      return [];
    }
    
    console.log(`Parsing HTML for parameter: ${parameter}`);
    console.log(`First 200 characters of HTML: ${html.substring(0, 200)}`);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    try {
      // Extract tables from the document
      const tables = doc.querySelectorAll('table');
      console.log(`Found ${tables.length} tables in HTML for parameter ${parameter}`);
      
      if (tables.length > 0) {
        console.log(`First table preview: ${tables[0].outerHTML.substring(0, 300)}`);
      }
      
      if (tables.length === 0) {
        console.warn('No tables found in the HTML');
        return [];
      }
    
    // Get the table with the most rows (likely our data table)
    let dataTable = tables[0];
    let maxRows = tables[0].querySelectorAll('tr').length;
    
    for (let i = 1; i < tables.length; i++) {
      const rowCount = tables[i].querySelectorAll('tr').length;
      if (rowCount > maxRows) {
        maxRows = rowCount;
        dataTable = tables[i];
      }
    }
    
    console.log(`Selected data table with ${maxRows} rows`);
    
    // Get all rows
    const rows = dataTable.querySelectorAll('tr');
    
    // Look at second row (index 1) for headers
    if (rows.length < 2) {
      console.warn('Table has fewer than 2 rows');
      return [];
    }
    
    // Extract headers from second row
    const headerRow = rows[1];
    const headerCells = headerRow.querySelectorAll('td');
    
    console.log(`Header row has ${headerCells.length} cells`);
    
    // Replace the existing check
    if (headerCells.length < 2) { // Reduce minimum required cells
      console.warn(`Header row has only ${headerCells.length} cells for parameter ${parameter}`);
      // For PM2.5 we might need special handling
      if (parameter === 'pm25' || parameter === 'pm25nowCast') {
        console.log('Attempting to use alternative parsing method for PM2.5 data');
        // Try to find a different row that might contain headers
        for (let i = 2; i < rows.length && i < 5; i++) {
          const altHeaderCells = rows[i].querySelectorAll('td');
          if (altHeaderCells.length >= 2) {
            console.log(`Found alternative header row with ${altHeaderCells.length} cells`);
            headerCells = altHeaderCells;
            break;
          }
        }
      } else {
        return []; // For other parameters, we can still return empty
      }
    }
    
    // Extract header texts 
    const headerTexts = Array.from(headerCells).map(cell => cell.textContent.trim());
    
    // Find indices for Fecha and Hora
    const fechaIndex = headerTexts.findIndex(text => 
      text.toLowerCase() === 'fecha' || text.toLowerCase().includes('fecha'));
    
    const horaIndex = headerTexts.findIndex(text => 
      text.toLowerCase() === 'hora' || text.toLowerCase().includes('hora'));
    
    console.log(`Fecha index: ${fechaIndex}, Hora index: ${horaIndex}`);
    
    if (horaIndex === -1) {
      console.warn('Could not find Hora column');
      return [];
    }
    
    // Get station names - all columns after hora
    const stationStartIndex = horaIndex + 1;
    let stationIndices = new Map();
    
    // Add each station name and its column index to the map
    for (let i = stationStartIndex; i < headerTexts.length; i++) {
      const stationName = headerTexts[i].trim();
      if (stationName && stationName.length > 0) {
        // Skip if we're only interested in a specific station and this isn't it
        if (specificStation && stationName !== specificStation) {
          continue;
        }
        stationIndices.set(stationName, i);
      }
    }
    
    console.log(`Found ${stationIndices.size} stations to process`);
    
    // Use the specified day or extract it
    let day = specificDay ? specificDay.toString().padStart(2, '0') : null;
    
    // Get current date and time for filtering future hours
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = (now.getMonth() + 1).toString().padStart(2, '0');
    const currentDay = now.getDate().toString().padStart(2, '0');
    const currentHour = now.getHours();
    
    // Process data rows (starting from row after headers)
    for (let rowIndex = 2; rowIndex < rows.length; rowIndex++) {
      const cells = rows[rowIndex].querySelectorAll('td');
      
      // Skip rows with too few cells
      if (cells.length <= stationStartIndex) {
        continue;
      }
      
      // Get date if fecha column exists
      let rowDay = day;
      if (fechaIndex !== -1 && fechaIndex < cells.length) {
        const fechaText = cells[fechaIndex].textContent.trim();
        const dateMatch = fechaText.match(/(\d+)[\/\-](\d+)[\/\-](\d+)/);
        
        if (dateMatch) {
          // Extract day based on format
          if (parseInt(dateMatch[3]) > 31) { // DD/MM/YYYY
            rowDay = dateMatch[1].padStart(2, '0');
          } else if (parseInt(dateMatch[1]) > 31) { // YYYY/MM/DD
            rowDay = dateMatch[3].padStart(2, '0');
          } else { // MM/DD/YYYY
            rowDay = dateMatch[2].padStart(2, '0');
          }
        }
      }
      
      if (!rowDay && specificDay) {
        rowDay = specificDay.padStart(2, '0');
      } else if (!rowDay) {
        // If we still don't have a day, skip this row
        continue;
      }
      
      // Get hour value
      let hourText = '';
      let hour = null;
      
      if (horaIndex < cells.length) {
        hourText = cells[horaIndex].textContent.trim();
        const hourMatch = hourText.match(/(\d+)/);
        
        if (hourMatch) {
          hour = parseInt(hourMatch[1]);
        }
      }
      
      // Skip if hour is invalid
      if (hour === null || isNaN(hour) || hour < 0 || hour > 23) {
        continue;
      }
      
      // Skip if we only want a specific hour and this isn't it
      if (specificHour !== null && parseInt(specificHour) !== hour) {
        continue;
      }
      
      // Skip future hours (if the date is current or future)
      const isCurrentDay = parseInt(year) === currentYear && 
                          month === currentMonth && 
                          rowDay === currentDay;
      
      const isFutureDay = parseInt(year) > currentYear || 
                         (parseInt(year) === currentYear && parseInt(month) > parseInt(currentMonth)) ||
                         (parseInt(year) === currentYear && month === currentMonth && parseInt(rowDay) > parseInt(currentDay));
      
      if (isFutureDay || (isCurrentDay && hour > currentHour)) {
        console.log(`Skipping future time: ${year}-${month}-${rowDay} ${hour}:00`);
        continue;
      }
      
      // Format hour with leading zero
      const formattedHour = hour.toString().padStart(2, '0');
      
      // Process each station we're interested in
      for (const [stationName, colIndex] of stationIndices.entries()) {
        if (colIndex >= cells.length) {
          continue;
        }
        
        const valueCell = cells[colIndex];
        const valueText = valueCell.textContent.trim();
        
        // Process all values, including special ones like 'NR'
        if (valueText) {
          // Check if it's a special value like 'NR', 'N/D', etc.
          if (['', '-', 'n/d', 'nr', 'nv', '**', 'na', 'n/a'].includes(valueText.toLowerCase())) {
            // Add a data point with null value but preserve the entry
            data.push({
              date: `${year}-${month}-${rowDay}`,
              hour: formattedHour,
              value: null,
              rawValue: valueText.toUpperCase(), // Store the original text
              station: stationName,
              parameter: parameter
            });
            
            console.log(`Added null data: ${year}-${month}-${rowDay} ${formattedHour}:00, Station: ${stationName}, Value: ${valueText}`);
          } else {
            // Parse the value for numeric entries
            const cleanText = valueText.replace(/[^\d.]/g, '');
            
            if (cleanText) {
              const value = parseFloat(cleanText);
              
              if (!isNaN(value)) {
                // Add the data point
                data.push({
                  date: `${year}-${month}-${rowDay}`,
                  hour: formattedHour,
                  value: value,
                  rawValue: value.toString(),
                  station: stationName,
                  parameter: parameter
                });
                
                console.log(`Added: ${year}-${month}-${rowDay} ${formattedHour}:00, Station: ${stationName}, Value: ${value}`);
              }
            }
          }
        }
      }
    }
    
    console.log(`Successfully extracted ${data.length} data points`);
    
  } catch (error) {
    console.error('Error parsing HTML:', error);
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
        // Skip null values when calculating averages
        if (item.value === null) return;
        
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
