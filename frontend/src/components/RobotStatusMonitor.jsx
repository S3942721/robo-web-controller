import { useState, useEffect, useCallback } from 'react';
import FoldableSection from './FoldableSection';

export default function RobotStatusMonitor({ foldable = true, compact = false, targetRobot = 'All' }) {
    const [robotStatus, setRobotStatus] = useState({});
    const [statusConfig, setStatusConfig] = useState(null);
    const [lastUpdate, setLastUpdate] = useState(null);
    const [connectionStatus, setConnectionStatus] = useState('disconnected');

    const loadRobotStatus = useCallback(async () => {
        try {
            const url = targetRobot === 'All' 
                ? '/api/robot-status/detailed'
                : `/api/robot-status/detailed?robot=${encodeURIComponent(targetRobot)}`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            setRobotStatus(data);
            setLastUpdate(new Date());
            setConnectionStatus('connected');
        } catch (error) {
            console.error('Failed to load robot status:', error);
            setConnectionStatus('error');
        }
    }, [targetRobot]);

    useEffect(() => {
        // Load status configuration
        fetch('/api/robot-status/config')
            .then(response => response.json())
            .then(data => {
                setStatusConfig(data);
                console.log('Status config loaded:', data);
            })
            .catch(error => console.error('Failed to load status config:', error));

        // Initial status load
        loadRobotStatus();

        // Set up polling for status updates
        const interval = setInterval(loadRobotStatus, 2000); // Poll every 2 seconds

        return () => clearInterval(interval);
    }, [targetRobot, loadRobotStatus]);

    const getStatusCategoryConfig = (category) => {
        return statusConfig?.statusConfig?.statusCategories?.[category] || { 
            color: '#666666', 
            description: category 
        };
    };

    const getStatusFieldConfig = (fieldName) => {
        return statusConfig?.statusConfig?.statusDefinitions?.[fieldName] || 
               { type: 'unknown', description: fieldName };
    };

    const formatStatusValue = (value, fieldConfig) => {
        if (value === null || value === undefined) return 'N/A';
        
        switch (fieldConfig.type) {
            case 'boolean':
                return value ? '✅' : '❌';
            case 'number':
                if (fieldConfig.unit) {
                    return `${value} ${fieldConfig.unit}`;
                }
                return value.toString();
            case 'timestamp':
                return value ? new Date(value).toLocaleTimeString() : 'Never';
            default:
                return value.toString();
        }
    };

    const getStatusColor = (value, fieldConfig) => {
        if (fieldConfig.critical_threshold !== undefined) {
            if ((fieldConfig.max !== undefined && value >= fieldConfig.critical_threshold) ||
                (fieldConfig.min !== undefined && value <= fieldConfig.critical_threshold)) {
                return '#f44336'; // Red for critical
            }
        }
        
        if (fieldConfig.warning_threshold !== undefined) {
            if ((fieldConfig.max !== undefined && value >= fieldConfig.warning_threshold) ||
                (fieldConfig.min !== undefined && value <= fieldConfig.warning_threshold)) {
                return '#ff9800'; // Orange for warning
            }
        }
        
        return '#4caf50'; // Green for normal
    };

    const categorizeStatus = (status) => {
        const categories = {};
        
        Object.entries(status).forEach(([key, value]) => {
            if (key === '_metadata') return;
            
            const fieldConfig = getStatusFieldConfig(key);
            const category = fieldConfig.category || 'other';
            
            if (!categories[category]) {
                categories[category] = [];
            }
            
            categories[category].push({
                key,
                value,
                config: fieldConfig
            });
        });
        
        return categories;
    };

    const renderStatusField = (field) => {
        const { key, value, config } = field;
        const color = config.type === 'number' ? getStatusColor(value, config) : '#666';
        const formattedValue = formatStatusValue(value, config);
        
        return (
            <div key={key} className="status-field" style={{ borderLeft: `3px solid ${color}` }}>
                <div className="status-field-name" title={config.description}>
                    {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </div>
                <div className="status-field-value" style={{ color }}>
                    {formattedValue}
                </div>
            </div>
        );
    };

    const renderRobotStatus = (robotName, status) => {
        const categories = categorizeStatus(status);
        const categoryConfigs = statusConfig?.statusConfig?.statusCategories || {};
        
        // Sort categories by priority
        const sortedCategories = Object.entries(categories).sort(([a], [b]) => {
            const aPriority = categoryConfigs[a]?.priority || 999;
            const bPriority = categoryConfigs[b]?.priority || 999;
            return aPriority - bPriority;
        });

        return (
            <div key={robotName} className="robot-status-container">
                <h3 className="robot-name">
                    {robotName}
                    {status._metadata && (
                        <span className="last-update" title={`Last update: ${new Date(status._metadata.lastUpdate).toLocaleString()}`}>
                            🔄 {new Date(status._metadata.lastUpdate).toLocaleTimeString()}
                        </span>
                    )}
                </h3>
                
                {sortedCategories.map(([categoryName, fields]) => {
                    const categoryConfig = getStatusCategoryConfig(categoryName);
                    
                    return (
                        <div key={categoryName} className="status-category">
                            <h4 
                                className="category-title" 
                                style={{ color: categoryConfig.color }}
                                title={categoryConfig.description}
                            >
                                {categoryName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </h4>
                            <div className="status-fields-grid">
                                {fields.map(renderStatusField)}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    if (compact) {
        // Compact view - show only critical status
        const allRobots = targetRobot === 'All' ? Object.keys(robotStatus) : [targetRobot];
        
        return (
            <div className="robot-status-compact">
                {allRobots.map(robotName => {
                    const status = robotStatus[robotName];
                    if (!status) return null;
                    
                    const criticalFields = ['speaking', 'listening', 'battery_level', 'connection_quality'];
                    
                    return (
                        <div key={robotName} className="robot-status-compact-item">
                            <strong>{robotName}:</strong>
                            {criticalFields.map(field => {
                                if (status[field] === undefined) return null;
                                const config = getStatusFieldConfig(field);
                                return (
                                    <span key={field} className="compact-status-field">
                                        {field}: {formatStatusValue(status[field], config)}
                                    </span>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        );
    }

    return (
        <FoldableSection title={`Robot Status Monitor${targetRobot !== 'All' ? ` - ${targetRobot}` : ''}`} foldable={foldable}>
            <div className="robot-status-monitor">
                <div className="status-header">
                    <div className={`connection-indicator ${connectionStatus}`}>
                        {connectionStatus === 'connected' && '🟢 Connected'}
                        {connectionStatus === 'disconnected' && '🔴 Disconnected'}
                        {connectionStatus === 'error' && '🟡 Error'}
                    </div>
                    {lastUpdate && (
                        <div className="last-refresh">
                            Last refresh: {lastUpdate.toLocaleTimeString()}
                        </div>
                    )}
                    <button onClick={loadRobotStatus} className="refresh-btn">
                        🔄 Refresh
                    </button>
                </div>

                {!statusConfig ? (
                    <div className="loading">Loading status configuration...</div>
                ) : Object.keys(robotStatus).length === 0 ? (
                    <div className="no-data">No robot status data available</div>
                ) : (
                    <div className="robots-grid">
                        {Object.entries(robotStatus).map(([robotName, status]) => 
                            renderRobotStatus(robotName, status)
                        )}
                    </div>
                )}
            </div>
        </FoldableSection>
    );
}
