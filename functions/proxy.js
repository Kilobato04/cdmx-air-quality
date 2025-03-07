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
    
    // Make the request to the CDMX website
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml'
      }
    });
    
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
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message
      })
    };
  }
};
