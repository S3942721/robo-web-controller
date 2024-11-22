import { useState } from "react";
import { CaretRight } from "./icons";

export default function FoldableSection({ className, children, title }) {

    const [folded, setFolded] = useState(false);

    return (
        <section className={`${className || ''}${folded ? ' folded':''}`}>
            <div 
                className="title-bar clickable"
                onClick={()=>setFolded(!folded)}
            >
                <div className={`fold-button ${folded?'expand':''}`}><CaretRight /></div>
                { title ? <h1>{title}</h1> : <></>}
            </div>
            <div className={`foldable ${folded ? 'folded':undefined}`}>
                { children }
            </div>
        </section>
    )
}