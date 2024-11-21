import { useEffect, useState } from "react";
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css'
import request from "../../utils/request";

export default function UploadSettings() {

    const [file, pickFile] = useState(null);
    const [possbile_names, setPossibleNames] = useState([]);
    const [filename, setFilename] = useState('')

    async function upload() {
        if(!file) {
            toast.error("No file selected!")
            return;
        }
        if(!filename) {
            toast.error("Please choose a filename!")
            return;
        }
        if(!/\.json$/.test(file.name)) {
            toast.error("The file is not json!")
            return;
        }
        
        const req = await request(`api/file-upload?${new URLSearchParams({ name: filename }).toString()}`, {
            body: file
        }, { returns_json: false, not_override_body: true });
        if(!req) {
            toast.warning("Something unexpected happens, please try again.")
        } else {
            toast.info("Upload success")
        }
    }

    useEffect(()=>{
        (async function() {
            const possible_file_names = await request("api/get-possible-files", {
                method: 'GET'
            })
            setPossibleNames(possible_file_names || []);
        })()
    }, [])

    return (
        <div className="upload-setting-main">
            <div className="upload-file-container">
                <input type="file" onChange={e=>pickFile(e.target.files[0] ?? null)} className="upload-setting-input clickable" />
                <div className="text">{file && file.name ? `Selected: ${file.name}` : 'Click or drag json file here to upload'}</div>
            </div>
            <select onChange={e=>setFilename(e.target.value)} className="select-agenda-name">
                <option value=''>Please select a filename</option>
                { possbile_names.map((name, i)=>{
                    return <option key={`filename-${i}`} value={name}>{name}</option>
                }) }
            </select>
            <div className="btn" onClick={upload}>Confirm Upload</div>
            <ToastContainer
                position="top-right"
                autoClose={3000}
                hideProgressBar={false}
                newestOnTop={false}
                closeOnClick
                rtl={false}
                pauseOnFocusLoss={false}
                draggable={false}
                pauseOnHover={false}
                theme="dark"
            />
        </div>
    )
}