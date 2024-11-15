export default function trigger({title, status, setStatus, sendTriggerUpdate}) {

    function selectTriggerChange(event) {
        setStatus(event.target.checked);
        sendTriggerUpdate(title, status)
    }

    return (
        <div className="trigger">
            <input className="trigger-checkbox" type="checkbox" value={status} onChange={selectTriggerChange} />
            <div className="title">{title}</div>
        </div>
    )
}