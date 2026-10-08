package org.xaspire.WuhouCake.bootstrap.integration;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

@TableName("scaffold_probe")
public class ProbeRecord {
    @TableId(type = IdType.INPUT)
    private Long id;
    private String note;

    public ProbeRecord() { }
    public ProbeRecord(Long id, String note) {
        this.id = id;
        this.note = note;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }
}
