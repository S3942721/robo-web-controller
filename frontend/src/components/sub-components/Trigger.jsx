export default function trigger({title, signal, value, setStatus, sendTriggerUpdate}) {

    function selectTriggerChange(event) {
        const val = event.target.checked
        const status_obj = { Signal:signal, Value:val }
        setStatus(status_obj);
        sendTriggerUpdate(title, status_obj)
    }

    return (
        <div className="trigger">
            <input className="trigger-checkbox" type="checkbox" checked={value} onChange={selectTriggerChange} />
            <div className="title">{title}</div>
        </div>
    )
}