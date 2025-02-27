import { useState } from "react"

export default function ScrollBar({ name, initial, max, min, step, callback, compact=false}) {
    const [value, setValue] = useState(initial);

    function updateValue(event) {
        const value = +event.target.value;
        callback && callback(value)
        setValue(value);
    }

    if (compact) {
        return (
            <div className="scroll-bar-container compact" >
                <div className="number compact">{ name }: {value}</div>
                <input type="range" min={min ?? 0} max={max ?? 100} step={step ?? 1} onChange={updateValue} value={value} />
            </div>
        )
    }

    return (
        <div className="scroll-bar-container" >
            <h3>{ name }</h3>
            <div className="number">Current Value: {value}</div>
            <input type="range" min={min ?? 0} max={max ?? 100} step={step ?? 1} onChange={updateValue} value={value} />
        </div>
    )
}