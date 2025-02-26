import React from 'react';

export default function FullScreenSection({ className, children, title }) {
    return (
        <div className={`${className}`}>
            {React.Children.map(children, child => 
                React.cloneElement(child, { foldable: false })
            )}
        </div>
    )
}
