const axios = require('axios');

exports.handler = async function(event, context) {
  try {
    const { qtipo, parametro, anio, qmes, dia, hora, qestacion } = event.queryStringParameters || {};
    
    // Build the URL for the CDMX air quality data
    let url = 'http://www.aire.cdmx.gob.mx/estadisticas-consultas/concentraciones/respuesta.php';
    url += `?qtipo=${qtipo || 'HORARIOS'}`;
    url += `&parametro=${parametro || 'o3'}`;
    url += `&anio=${anio || '2025'}`;
    url += `&qmes=${qmes || '03'}`;
    
    // Add optional parameters if they exist
    if (dia) url += `&dia=${dia}`;
    if (hora) url += `&hora=${hora}`;
    if (qestacion) url += `&qestacion=${qestacion}`;
    
    console.log(`Fetching data from: ${url}`);
    
    // Make the request to the CDMX website with better headers
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'http://www.aire.cdmx.gob.mx/default.php'
      },
      timeout: 10000 // 10 seconds timeout
    });
    
    // Log some debug info about the response
    console.log(`Response status: ${response.status}`);
    console.log(`Content length: ${response.data.length}`);
    console.log(`Content preview: ${response.data.substring(0, 200)}...`);
    
    // Check if response contains table indicators
    if (response.data.includes('<table') && response.data.includes('</table>')) {
      console.log('Response contains table tags');
    } else {
      console.log('Warning: Response does not contain table tags');
    }
    
    // Return the HTML response
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/html; charset=utf-8'
      },
      body: response.data
    };
  } catch (error) {
    console.error('Error details:', error);
    
    // More detailed error information
    const errorInfo = {
      message: error.message,
      url: error.config?.url || 'URL not available',
      statusCode: error.response?.status || 'Status not available',
      responseData: error.response?.data ? error.response.data.substring(0, 500) : 'Response data not available'
    };
    
    console.log('Error info:', JSON.stringify(errorInfo));
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: error.message,
        details: errorInfo
      })
    };
  }
};
