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
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  try {
    // Extract tables from the document
    const tables = doc.querySelectorAll('table');
    
    if (!tables || tables.length === 0) {
      console.warn('No tables found in the HTML');
      return [];
    }
    
    // Try to find the main data table (it usually has many columns with station data)
    let dataTable = null;
    
    for (let i = 0; i < tables.length; i++) {
      // Check if this table has a row with station headers
      const firstRow = tables[i].querySelector('tr');
      if (firstRow && firstRow.querySelectorAll('th').length > 5) {
        // This looks like our data table with multiple station columns
        dataTable = tables[i];
        break;
      }
    }
    
    if (!dataTable) {
      console.warn('Data table not found in the HTML');
      return [];
    }
    
    // Extract date information (day) from the HTML
    let day = '01'; // Default to first day if not found
    
    if (specificDay) {
      // If a specific day was requested, use that
      day = specificDay.toString().padStart(2, '0');
    } else {
      // Try to extract day from the HTML page content
      const dayMatch = html.match(/Día:?\s*(\d+)/i) || html.match(/Dia:?\s*(\d+)/i);
      if (dayMatch) {
        day = parseInt(dayMatch[1]).toString().padStart(2, '0');
      }
    }
    
    console.log(`Processing data for date: ${year}-${month}-${day}`);
    
    // Extract column headers (stations)
    const headerCells = dataTable.querySelectorAll('tr:first-child th');
    const stations = [];
    
    // Skip first column (hour column) if present
    for (let i = 1; i < headerCells.length; i++) {
      const stationText = headerCells[i].textContent.trim();
      // Stations are usually 3-letter codes like "ACO", "MER", etc.
      if (stationText.length > 0) {
        stations.push(stationText);
      }
    }
    
    if (stations.length === 0) {
      console.warn('No station headers found in the table');
      return [];
    }
    
    console.log(`Found ${stations.length} stations: ${stations.join(', ')}`);
    
    // Extract rows (hours)
    const rows = dataTable.querySelectorAll('tr');
    
    // For each row after the header
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].querySelectorAll('td');
      
      // Skip if no cells
      if (cells.length === 0) continue;
      
      let hour;
      
      // First cell should be the hour
      const hourText = cells[0].textContent.trim();
      
      // Try to parse hour - it could be a simple number or have text like "Hora: 12"
      if (/^\d{1,2}$/.test(hourText)) {
        hour = parseInt(hourText);
      } else {
        // Try to extract hours from text format
        const hourMatch = hourText.match(/(\d{1,2})/);
        if (hourMatch) {
          hour = parseInt(hourMatch[1]);
        } else {
          // Skip rows that don't have a valid hour
          console.warn(`Skipping row with invalid hour format: ${hourText}`);
          continue;
        }
      }
      
      // Format hour with leading zero if needed
      const formattedHour = hour.toString().padStart(2, '0');
      
      // For each station (skipping first cell which is the hour)
      for (let j = 1; j < cells.length && j-1 < stations.length; j++) {
        const stationId = stations[j-1];
        const valueText = cells[j].textContent.trim();
        
        // Skip empty or invalid values (often displayed as "-", "N/D", or similar)
        if (valueText && !['', '-', 'N/D', 'NR', 'NV', '**'].includes(valueText)) {
          try {
            // Parse the value (remove any non-numeric characters except decimal point)
            // If real data doesn't have decimals, we'll extract the integer value
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
    throw error;
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
