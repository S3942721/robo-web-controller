export default function trigger({title, status, setStatus, sendTriggerUpdate}) {

    function selectTriggerChange(event) {
        const s = event.target.checked
        setStatus(s);
        sendTriggerUpdate(title, s)
    }

    return (
        <div className="trigger">
            <input className="trigger-checkbox" type="checkbox" checked={status} onChange={selectTriggerChange} />
            <div className="title">{title}</div>
        </div>
    )
}