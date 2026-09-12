import { useMemo } from "react";
import { CaretRight } from "./icons";
import { usePersistentState } from "../utils/persistentState";

export default function FoldableSection({ className, children, title, foldable = true, compact = false }) {

    const sectionKey = useMemo(() => {
        const base = title || className || 'untitled-section'
        return `web-controller.foldable-section.${base}`
    }, [title, className])

    const [folded, setFolded] = usePersistentState(sectionKey, false);

    if (!foldable) {
        return (
            <div className={`${className || ''} ${compact ? 'compact' : ''}`} style={{padding: '10px'}}>
                { children }
            </div>
        )
    }
    return (
        <section className={`${className || ''}${folded ? ' folded':''}`}>
            <div 
                className="title-bar clickable"
                onClick={()=>setFolded(!folded)}
            >
                <div className={`fold-button ${folded?'expand':''}`}><CaretRight /></div>
                { title ? <h1>{title}</h1> : <></>}
            </div>
            <div className={`foldable ${folded ? 'folded' : ''} ${compact ? 'compact' : ''}`}>
                { children }
            </div>
        </section>
    )
}