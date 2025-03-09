import { useState } from "react"

export default function ScrollBar({
    name,
    initial = 0,       // For backward compatibility
    value,             // If defined, component is controlled
    min = 0,
    max = 100,
    step = 1,
    onChange,
    compact = false
}) {
    // Use local state only if "value" is undefined:
    const [localValue, setLocalValue] = useState(initial);
    const displayedValue = value ?? localValue;

    function handleChange(e) {
        const newVal = +e.target.value;
        onChange?.(newVal);
        // Update local state in uncontrolled mode:
        if (value === undefined) {
            setLocalValue(newVal);
        }
    }

    if (compact) {
        return (
            <div className="scroll-bar-container compact" >
                <div className="number compact">{ name }: {displayedValue}</div>
                <input type="range" min={min} max={max} step={step} onChange={handleChange} value={displayedValue} />
            </div>
        )
    }

    return (
        <div className="scroll-bar-container" >
            <h3>{ name }</h3>
            <div className="number">Current Value: {displayedValue}</div>
            <input type="range" min={min} max={max} step={step} onChange={handleChange} value={displayedValue} />
        </div>
    )
}