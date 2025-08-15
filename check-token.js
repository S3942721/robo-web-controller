require('dotenv').config();

// Decode JWT token to check expiration
function decodeToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        return payload;
    } catch (e) {
        return null;
    }
}

const sessionToken = process.env.AWS_SESSION_TOKEN;
if (sessionToken) {
    const decoded = decodeToken(sessionToken);
    if (decoded && decoded.exp) {
        const expTime = new Date(decoded.exp * 1000);
        const now = new Date();
        console.log('Token expires at:', expTime.toLocaleString());
        console.log('Current time:', now.toLocaleString());
        console.log('Token expired:', now > expTime ? '❌ YES' : '✅ NO');
    } else {
        console.log('Could not decode token expiration');
    }
} else {
    console.log('No session token found');
}