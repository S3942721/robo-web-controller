import { useState } from "react";
import { CaretRight } from "./icons";

export default function FoldableSection({ className, children, title, foldable = true, compact = false }) {

    const [folded, setFolded] = useState(false);

    if (!foldable) {
        console.log('FoldableSection.jsx: foldable is false')
        return (
            <div className={`${className || ''} ${compact ? 'compact' : ''}`}>
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