export async function loadConfig() {
    const configPaths = [
        '/config/config.json',
        './config/config.json',
        '../config/config.json'
    ];

    let lastError = null;

    for (const path of configPaths) {
        try {
            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`Failed to load config from ${path}. HTTP ${response.status}`);
            }

            const config = await response.json();
            if (!config || typeof config !== 'object') {
                throw new Error(`Invalid config at ${path}: expected a JSON object.`);
            }

            return config;
        } catch (error) {
            lastError = error;
        }
    }

    console.error('Configuration load error:', lastError);
    throw lastError;
}
