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
  
  console.log('HTML preview:', html.substring(0, 300));
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  try {
    // Extract tables from the document
    const tables = doc.querySelectorAll('table');
    console.log(`Found ${tables.length} tables in HTML`);
    
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
    
    // Handle case with table structure as described: Fecha, Hora, then station names
    // Look at second row (index 1) for headers
    if (rows.length < 2) {
      console.warn('Table has fewer than 2 rows');
      return [];
    }
    
    // Extract headers from second row
    const headerRow = rows[1];
    const headerCells = headerRow.querySelectorAll('td');
    
    console.log(`Header row has ${headerCells.length} cells`);
    
    if (headerCells.length < 3) {
      console.warn('Header row does not have enough cells');
      return [];
    }
    
    // Extract header texts
    const headerTexts = Array.from(headerCells).map(cell => cell.textContent.trim());
    console.log(`Headers: ${headerTexts.slice(0, 5).join(', ')}...`);
    
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
    const stations = headerTexts.slice(stationStartIndex);
    
    console.log(`Found ${stations.length} stations: ${stations.slice(0, 5).join(', ')}...`);
    
    // Use the specified day or extract it
    let day = specificDay ? specificDay.toString().padStart(2, '0') : '01';
    
    // Process data rows (starting from row after headers)
    for (let rowIndex = 2; rowIndex < rows.length; rowIndex++) {
      const cells = rows[rowIndex].querySelectorAll('td');
      
      // Skip rows with too few cells
      if (cells.length <= stationStartIndex) continue;
      
      // Get hour value
      let hour = null;
      
      // Extract hour from the hora column
      if (horaIndex < cells.length) {
        const hourText = cells[horaIndex].textContent.trim();
        const hourMatch = hourText.match(/(\d+)/);
        
        if (hourMatch) {
          hour = parseInt(hourMatch[1]);
        }
      }
      
      // Skip if hour is invalid
      if (hour === null || isNaN(hour) || hour < 0 || hour > 23) {
        console.log(`Skipping row ${rowIndex} with invalid hour`);
        continue;
      }
      
      // Format hour with leading zero
      const formattedHour = hour.toString().padStart(2, '0');
      
      // Try to extract date if fecha column exists and specificDay is not provided
      if (!specificDay && fechaIndex !== -1 && fechaIndex < cells.length) {
        const fechaText = cells[fechaIndex].textContent.trim();
        const dateMatch = fechaText.match(/(\d+)[\/\-](\d+)[\/\-](\d+)/);
        
        if (dateMatch) {
          // Different date formats: DD/MM/YYYY or YYYY/MM/DD or MM/DD/YYYY
          // Determine format based on ranges
          let extractedDay, extractedMonth, extractedYear;
          
          if (parseInt(dateMatch[3]) > 31) {
            // Format is DD/MM/YYYY
            extractedDay = dateMatch[1];
            extractedMonth = dateMatch[2];
            extractedYear = dateMatch[3];
          } else if (parseInt(dateMatch[1]) > 31) {
            // Format is YYYY/MM/DD
            extractedYear = dateMatch[1];
            extractedMonth = dateMatch[2];
            extractedDay = dateMatch[3];
          } else {
            // Guess MM/DD/YYYY (commonly used in Mexico)
            extractedMonth = dateMatch[1];
            extractedDay = dateMatch[2];
            extractedYear = dateMatch[3];
          }
          
          // Update day from extracted date
          day = parseInt(extractedDay).toString().padStart(2, '0');
          console.log(`Extracted day ${day} from date cell: ${fechaText}`);
        }
      }
      
      // Process each station's data
      for (let stationIndex = 0; stationIndex < stations.length; stationIndex++) {
        const cellIndex = stationStartIndex + stationIndex;
        
        if (cellIndex >= cells.length) continue;
        
        const stationId = stations[stationIndex];
        const valueCell = cells[cellIndex];
        const valueText = valueCell.textContent.trim();
        
        // Skip empty or special values
        if (valueText && !['', '-', 'N/D', 'NR', 'NV', '**', 'NA', 'n/a'].includes(valueText.toLowerCase())) {
          // Parse the value
          const cleanValue = valueText.replace(/[^\d.]/g, '');
          
          if (cleanValue && cleanValue.length > 0) {
            const value = parseFloat(cleanValue);
            
            if (!isNaN(value)) {
              // Add the data point
              data.push({
                date: `${year}-${month}-${day}`,
                hour: formattedHour,
                value: value,
                station: stationId,
                parameter: parameter
              });
              
              console.log(`Added data: ${year}-${month}-${day} ${formattedHour}:00, Station: ${stationId}, Value: ${value}`);
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
